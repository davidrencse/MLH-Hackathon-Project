// Optional Drizzle Kit introspection/generation configuration. Runtime applies the
// versioned SQL in src/db/migrations; generated migrations need an explicit version
// registered in Store before they are applied, never applied implicitly.
export default {
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./data/generated-migrations",
  dbCredentials: {
    url: process.env.GHOSTGRID_DATABASE_PATH ?? "./data/ghostgrid.sqlite",
  },
};
