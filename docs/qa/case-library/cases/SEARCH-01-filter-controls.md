---
id: SEARCH-01
page: /search
platforms: [desktop, mobile]
states: [default, focused, selected]
critical_payloads: [period, sort]
mutating: false
---

# Search filter controls

1. Open Search with a query. Check the time and sort controls beside the language switch.
2. Check desktop and 390×844 in dark and light appearances. Selects should use the site pill border, surface, typography and one downward chevron. Desktop control groups are 36 px high; mobile groups are 44 px high.
3. Switch among the five supported languages. Long labels may wrap the language group onto a second row; require no horizontal overflow, clipped selection or overlapping controls.
4. Focus each select using the keyboard; require a visible focus ring. Select a different period and Newest using the native picker. Verify the selected labels and URL parameters persist after reload.
5. Check the public production search page after the deployment succeeds. Local fixture layout evidence does not prove live result counts or search API behavior.

The September 2026 style fix retains native select semantics and existing discovery route/API tests. MCP and observability are not applicable: no API, permission, search behavior or server execution changes.
