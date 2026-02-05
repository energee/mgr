# Debug Skill
1. Read the error message carefully and identify the component (DB, API, frontend)
2. For database errors: run `NOTIFY pgrst, 'reload schema'`, check enum_values table freshness, verify check constraints
3. For frontend errors: check browser console, verify data flow from API response to UI
4. Present root cause analysis before implementing fix
5. After fixing, verify the fix works end-to-end
