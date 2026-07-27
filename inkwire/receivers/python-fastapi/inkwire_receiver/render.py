import re
import markdown as md
import nh3
ALLOWED_TAGS = {"p","br","strong","em","a","ul","ol","li","code","pre","blockquote","h1","h2","h3","h4","img","hr","table","thead","tbody","tr","th","td"}
ALLOWED_ATTRS = {"a": {"href","title","rel"}, "img": {"src","alt","title"}}
def render_markdown(text: str) -> str:
    raw = md.markdown(text, extensions=["extra"])
    return nh3.clean(raw, tags=ALLOWED_TAGS, attributes=ALLOWED_ATTRS, url_schemes={"http","https","mailto"}, link_rel=None)
def slugify(s: str) -> str:
    out = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:255]
    return out or "post"
