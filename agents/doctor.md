{{stats}}
Merged lead-in blocks: {{mergedCount}} (short blocks folded into the next block as lead-in context).
Errors: {{failedCount}} (tool results with errors plus failed block analyses).

Block summaries:
{{reports}}

Produce a markdown analysis report of pain points (struggle, wasted time, inefficiency) with block number references. The analysed log is one run of the "{{role}}" role agent of a kanban pipeline. Identify what the agent lost most of its time on (pain points), then revise the role guidance file at {{roleFile}} so future runs of that role go more smoothly (a role file of none means there is no role file: do not write any file, produce the report only). You have full rewrite authority over the role file: compact it each run by merging duplicate guidance without losing unique rules, remove stale guidance, and keep it valid markdown guidance for the role.
