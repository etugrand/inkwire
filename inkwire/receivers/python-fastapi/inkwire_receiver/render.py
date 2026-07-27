import re
import markdown as md
import nh3
# Canonical allowlist per SPEC.md "Content safety": sanitize-html's default
# allowedTags union {img, h1, h2} (h1/h2 already in the default set). Keep in
# sync with core-ts/src/render.ts.
ALLOWED_TAGS = {
    "a","abbr","address","article","aside","b","bdi","bdo","blockquote","br",
    "caption","cite","code","col","colgroup","data","dd","dfn","div","dl","dt",
    "em","figcaption","figure","footer","h1","h2","h3","h4","h5","h6","header",
    "hgroup","hr","i","img","kbd","li","main","mark","menu","nav","ol","p",
    "pre","q","rb","rp","rt","rtc","ruby","s","samp","section","small","span",
    "strong","sub","sup","table","tbody","td","tfoot","th","thead","time","tr",
    "u","ul","var","wbr",
}
ALLOWED_ATTRS = {"a": {"href", "name", "rel"}, "img": {"src", "alt", "title"}}
def render_markdown(text: str) -> str:
    raw = md.markdown(text, extensions=["extra"])
    return nh3.clean(raw, tags=ALLOWED_TAGS, attributes=ALLOWED_ATTRS, url_schemes={"http","https","mailto"}, link_rel=None)
def slugify(s: str) -> str:
    out = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:255]
    return out or "post"
