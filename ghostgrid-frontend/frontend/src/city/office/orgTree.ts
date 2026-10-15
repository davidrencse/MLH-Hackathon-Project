// Why: the org chart's whole job is the reporting line, and no reporting line is stored — a team
// is a flat list of people with roles. This derives the same tree from it every time, so the
// chart can draw real nesting instead of implying it.
//
// It lives apart from OrgChart.tsx because that file has JSX in it, and `node --test` can strip
// types from a .ts but not from a .tsx: logic that needs checking without a browser has to sit
// in a plain module (see scripts/office-org.test.mjs).
import type { CrewMember } from './crew'

export interface OrgNode {
  member: CrewMember
  reports: OrgNode[]
}

/**
 * Leads report to the first manager, engineers spread evenly across the leads, and a team with
 * no lead has its engineers report to a manager directly instead of disappearing. Anyone with
 * nobody above them comes back as a root, so a person can never be dropped between levels.
 */
export function treeOf(people: CrewMember[]): OrgNode[] {
  const node = (member: CrewMember): OrgNode => ({ member, reports: [] })
  const managers = people.filter((person) => person.role === 'Manager').map(node)
  const leads = people.filter((person) => person.role === 'Team Lead').map(node)
  const engineers = people.filter((person) => person.role === 'Engineer')

  // An engineer reports to a lead where there is one, else straight to a manager, else to nobody.
  const hosts = leads.length ? leads : managers
  const unmanaged: OrgNode[] = []
  engineers.forEach((member, index) => {
    const host = hosts.length ? hosts[index % hosts.length] : undefined
    if (host) host.reports.push(node(member))
    else unmanaged.push(node(member))
  })

  if (managers.length) {
    for (const lead of leads) managers[0]!.reports.push(lead)
    return [...managers, ...unmanaged]
  }
  return [...leads, ...unmanaged]
}
