import { describe, it, expect, vi, afterEach } from "vitest";
import { Store } from "../src/db/store.js";
import {
  LibraryService,
  libraryConnectionSchema,
} from "../src/library/service.js";
afterEach(() => vi.unstubAllGlobals());
function setup() {
  const store = new Store(":memory:");
  store.insert("projects", { id: "project" });
  const library = new LibraryService(store);
  library.connect("project", { baseUrl: "http://127.0.0.1:8000" });
  return { store, library };
}
describe("read-only shared project library", () => {
  it("persists scoped audit events before publishing without leaking connection credentials or context", async () => {
    const store = new Store(":memory:");
    store.insert("projects", { id: "project" });
    const delivered: any[] = [];
    const library = new LibraryService(store, (event) => {
      expect(store.get("execution_events", event.id)).toEqual(event);
      delivered.push(event);
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ notes: "Private saved annotation" })),
      ),
    );
    try {
      library.connect("project", {
        baseUrl: "https://library.example",
        apiKeyEnv: "LIBRARY_PRIVATE_AUTH",
        buildingId: "archive",
      });
      // No credential is required until a remote read is performed.
      library.connect("project", {
        baseUrl: "https://library.example",
        buildingId: "archive",
      });
      const context = await library.importContext("project", {
        articleId: "article",
      });
      library.disconnect("project");
      library.disconnect("project");
      expect(delivered.map((event) => event.type)).toEqual([
        "library.connected",
        "library.connected",
        "context.created",
        "library.disconnected",
      ]);
      expect(
        delivered.every(
          (event) =>
            event.projectId === "project" &&
            event.buildingId === "archive" &&
            event.taskId === null,
        ),
      ).toBe(true);
      expect(delivered[2].data).toEqual({
        contextId: context.id,
        kind: "library",
      });
      expect(JSON.stringify(delivered)).not.toContain("LIBRARY_PRIVATE_AUTH");
      expect(JSON.stringify(delivered)).not.toContain(
        "Private saved annotation",
      );
      expect(store.get("context_entries", context.id)).toBeDefined();
    } finally {
      store.close();
    }
  });
  it("rolls back connection and context changes when their audit events cannot be persisted", async () => {
    const { store, library } = setup();
    const publisher = vi.fn();
    const audited = new LibraryService(store, publisher);
    const original = library.get("project");
    const eventSpy = vi.spyOn(store, "event").mockImplementation(() => {
      throw new Error("audit storage unavailable");
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ notes: "Saved notes" }))),
    );
    try {
      expect(() =>
        audited.connect("project", {
          baseUrl: "https://other.example",
          buildingId: "other",
        }),
      ).toThrow("audit storage unavailable");
      expect(library.get("project")).toEqual(original);
      expect(() => audited.disconnect("project")).toThrow(
        "audit storage unavailable",
      );
      expect(library.get("project")).toEqual(original);
      await expect(
        audited.importContext("project", { articleId: "article" }),
      ).rejects.toThrow("audit storage unavailable");
      expect(store.list("context_entries")).toEqual([]);
      expect(store.events().map((event) => event.type)).toEqual([
        "library.connected",
      ]);
      expect(publisher).not.toHaveBeenCalled();
    } finally {
      eventSpy.mockRestore();
      store.close();
    }
  });
  it.each([
    ["notes", null],
    ["notes", { notes: 42 }],
    ["notes", { highlights: "invalid" }],
    ["papers", { items: {} }],
    ["papers", { items: [null] }],
    ["papers", { items: [{ title: "missing id" }] }],
    ["status", {}],
    ["catalog", { articles: "invalid", total: 0 }],
    ["search", { items: [], total: "unknown" }],
    ["notebook", { entries: [null] }],
  ])(
    "rejects malformed %s payloads as upstream failures",
    async (operation, payload) => {
      const { store, library } = setup();
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(JSON.stringify(payload))),
      );
      try {
        const result = ["notes", "papers"].includes(operation)
          ? library.importContext(
              "project",
              operation === "notes"
                ? { articleId: "article" }
                : { paperId: "paper" },
            )
          : library.request(
              "project",
              operation as any,
              operation === "search" ? { q: "test" } : {},
            );
        await expect(result).rejects.toMatchObject({ statusCode: 502 });
        expect(store.list("context_entries")).toEqual([]);
      } finally {
        store.close();
      }
    },
  );
  it("normalizes imported paper titles to the shared context limit while retaining metadata", async () => {
    const { store, library } = setup();
    const title = "x".repeat(200);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ items: [{ id: "paper", title }] })),
      ),
    );
    try {
      const context = await library.importContext("project", {
        paperId: "paper",
      });
      expect(context.title).toHaveLength(160);
      expect(JSON.parse(context.content).title).toBe(title);
      await expect(
        library.importContext("project", { paperId: "paper", title }),
      ).rejects.toMatchObject({ statusCode: 400 });
    } finally {
      store.close();
    }
  });
  it("rejects unsafe URLs and conflicting building IDs", () => {
    for (const baseUrl of [
      "http://example.com",
      "https://user:pass@example.com",
      "https://example.com/?key=secret",
      "https://example.com/#route",
    ])
      expect(libraryConnectionSchema.safeParse({ baseUrl }).success).toBe(
        false,
      );
    expect(
      libraryConnectionSchema.safeParse({ baseUrl: "https://example.com" })
        .success,
    ).toBe(true);
    const { store, library } = setup();
    try {
      store.insert("providers", { id: "provider" });
      store.insert("agents", {
        id: "agent",
        projectId: "project",
        providerId: "provider",
        buildingId: "taken",
      });
      expect(() =>
        library.connect("project", {
          baseUrl: "https://example.com",
          buildingId: "taken",
        }),
      ).toThrow("already assigned");
      expect(library.get("project").name).toBe("Library of Babel");
      library.disconnect("project");
      expect(library.get("project")).toBeNull();
    } finally {
      store.close();
    }
  });
  it("only proxies fixed GET paths and whitelisted queries", async () => {
    const { store, library } = setup();
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ articles: [], total: 0 }), {
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      await library.request("project", "catalog", {
        offset: 2,
        limit: 10,
        access: "free",
      });
      const [url, options] = fetchMock.mock.calls[0] as unknown as [
        URL,
        RequestInit,
      ];
      expect(url.pathname).toBe("/api/library/page");
      expect(url.searchParams.get("limit")).toBe("10");
      expect(options).toMatchObject({ method: "GET", redirect: "error" });
      await expect(
        library.request("project", "catalog", { url: "https://evil.invalid" }),
      ).rejects.toThrow();
      await expect(
        library.request("project", "notes", {}, "../secret"),
      ).rejects.toThrow();
      await expect(
        library.request("project", "discover" as any),
      ).rejects.toThrow("Unsupported");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      store.close();
    }
  });
  it("imports saved notes and paper metadata with explicit context provenance", async () => {
    const { store, library } = setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (url: URL) =>
          new Response(
            JSON.stringify(
              url.pathname === "/api/papers"
                ? {
                    items: [
                      {
                        id: "paper_1",
                        title: "Saved paper",
                        doi: "10.1234/example",
                        raw: { private: "ignore" },
                      },
                    ],
                  }
                : {
                    notes: "Saved annotation",
                    summary: "Selected summary",
                    highlights: [{ text: "Selected passage" }],
                  },
            ),
          ),
      ),
    );
    try {
      const notes = await library.importContext("project", {
        articleId: "abc123",
        title: "Research notes",
      });
      expect(notes).toMatchObject({
        projectId: "project",
        title: "Research notes",
        source: {
          integration: "news",
          articleId: "abc123",
          buildingId: "library",
          projectId: "project",
        },
      });
      expect(JSON.parse(notes.content).notes).toBe("Saved annotation");
      const paper = await library.importContext("project", {
        paperId: "paper_1",
      });
      expect(paper.source.paperId).toBe("paper_1");
      expect(JSON.parse(paper.content).raw).toBeUndefined();
      expect(store.list("context_entries").map((x) => x.id)).toEqual([
        notes.id,
        paper.id,
      ]);
      await expect(
        library.importContext("project", {
          articleId: "abc",
          paperId: "paper_1",
        }),
      ).rejects.toThrow("exactly one");
    } finally {
      store.close();
    }
  });
  it("redacts configured credentials and keeps upstream errors bounded", async () => {
    const { store, library } = setup();
    process.env.GG_LIBRARY_AUTH = "library-test-secret";
    library.connect("project", {
      baseUrl: "https://library.example",
      apiKeyEnv: "GG_LIBRARY_AUTH",
    });
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: URL, options: RequestInit) => {
        expect((options.headers as any).Authorization).toBe(
          "Bearer library-test-secret",
        );
        calls++;
        if (calls === 1)
          return new Response(JSON.stringify({ notes: "library-test-secret" }));
        if (calls === 2)
          return new Response("upstream secret library-test-secret", {
            status: 401,
          });
        return new Response("{}", { headers: { "content-length": "3000000" } });
      }),
    );
    try {
      expect(await library.request("project", "notes", {}, "abc")).toEqual({
        notes: "[REDACTED]",
      });
      await expect(library.request("project", "status")).rejects.toMatchObject({
        statusCode: 502,
        message: "Library returned HTTP 401",
      });
      await expect(library.request("project", "status")).rejects.toThrow(
        "2 MB",
      );
    } finally {
      delete process.env.GG_LIBRARY_AUTH;
      store.close();
    }
  });
});
