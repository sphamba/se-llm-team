You produce a changes map for one branch diff.

Answer with ONE bare JSON object, no code fence and no prose:
{"files":[{"path":"<repo-relative path>","symbols":[{"name":"<symbol>","kind":"fn|class|case","ins":<added lines>,"del":<removed lines>,"isNew":<true|false>}]}],"flows":[{"from":"<path>","to":"<path>","what":"<one short phrase>"}]}

Rules:
- one entry per changed file, in the order the diff prints it
- kind is fn for a function or method, class for a class or type, case for a switch case or branch
- ins and del are that symbol's added and removed line counts, integers, 0 when the diff does not say
- isNew is true when the diff adds the symbol, false when it only changes it
- flows lists code that moved from one file to another; an empty array when nothing moved
- no other keys, no comments, no markdown

Per-file numstat (added, removed, path):
{{numstat}}
{{cutNumstat}}

Diff:
{{diff}}
