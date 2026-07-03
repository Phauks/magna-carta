#!/usr/bin/env python3
"""Generate viewer.html from profiles.json — a human verify/needs-fix coverage map.
Run from docs/research/wellbeing-resources/. Never hand-edit viewer.html; regenerate.
"""
import html
import json
from pathlib import Path

ROOT = Path(__file__).parent


def esc(x):
    return html.escape(str(x if x is not None else ""))


def phone_html(p):
    tag = {"aroundTheClock": "24/7", "businessHours": "business hrs", "unspecified": "hours n/a"}
    return (f'<span class="phone">{esc(p.get("number"))}'
            f' <em>{esc(p.get("label",""))} · {tag.get(p.get("availability"),"")}</em></span>')


def resource_html(r, jkey, idx):
    rid = f"{jkey}:{idx}"
    phones = " ".join(phone_html(p) for p in r.get("phones", []))
    url = r.get("url")
    link = f'<a href="{esc(url)}" target="_blank" rel="noreferrer">{esc(url)}</a>' if url else "<i>no url</i>"
    services = ", ".join(esc(s) for s in r.get("services", []))
    return f"""
    <div class="resource" data-conf="{esc(r.get('confidence'))}" data-id="{esc(rid)}">
      <div class="rhead">
        <b>{esc(r.get('name'))}</b>
        <span class="conf conf-{esc(r.get('confidence'))}">{esc(r.get('confidence'))}</span>
        <span class="tier">{esc(r.get('sourceTier'))}</span>
        <span class="optype">{esc(r.get('operatorType'))} · {esc(r.get('scope'))}</span>
        <span class="verified">verified {esc(r.get('verifiedOn'))}</span>
      </div>
      <div class="rbody">
        <div>{esc(r.get('operator'))}</div>
        <div>{link}</div>
        <div class="phones">{phones}</div>
        <div class="svc">{services}</div>
        <div class="meta">{esc(r.get('confidential',''))} · {esc(r.get('cost',''))}</div>
        <div class="desc">{esc(r.get('description',''))}</div>
        <div class="src">source: <a href="{esc(r.get('sourceUrl'))}" target="_blank" rel="noreferrer">{esc(r.get('sourceUrl'))}</a></div>
      </div>
      <div class="actions">
        <button class="verify" onclick="mark('{esc(rid)}','verify')">verify</button>
        <button class="needsfix" onclick="mark('{esc(rid)}','needsfix')">needs-fix</button>
        <span class="state" id="st-{esc(rid)}"></span>
      </div>
    </div>"""


def main():
    data = json.loads((ROOT / "profiles.json").read_text(encoding="utf-8"))
    nat = "".join(resource_html(r, "NATIONAL", i) for i, r in enumerate(data.get("national", [])))
    blocks = []
    for jkey, j in data.get("jurisdictions", {}).items():
        rs = "".join(resource_html(r, jkey, i) for i, r in enumerate(j.get("resources", [])))
        blocks.append(f'<section class="jx" data-code="{esc(j.get("code"))}">'
                      f'<h2>{esc(j.get("name"))} <small>{esc(j.get("code"))} · {esc(j.get("fips"))}</small></h2>{rs}</section>')
    count = len(data.get("jurisdictions", {}))
    page = f"""<!doctype html><html><head><meta charset="utf-8"><title>Wellbeing Resources — Coverage</title>
<style>
 body{{font:14px system-ui,sans-serif;margin:0;background:#f6f7f9;color:#1a1a1a}}
 header{{position:sticky;top:0;background:#fff;border-bottom:1px solid #ddd;padding:10px 16px;z-index:5}}
 .national{{background:#fff8e6;border:1px solid #e8d48a;margin:12px 16px;padding:8px 12px;border-radius:8px}}
 section.jx{{margin:12px 16px}}
 h2{{font-size:16px;margin:8px 0}} h2 small{{color:#888;font-weight:400}}
 .resource{{background:#fff;border:1px solid #e2e4e8;border-radius:8px;padding:8px 12px;margin:6px 0}}
 .rhead{{display:flex;gap:10px;align-items:center;flex-wrap:wrap}}
 .conf{{font-size:11px;padding:1px 6px;border-radius:10px;color:#fff}}
 .conf-HIGH{{background:#2e7d32}} .conf-MEDIUM{{background:#ef6c00}} .conf-LOW{{background:#c62828}} .conf-NA{{background:#607d8b}}
 .tier,.optype,.verified{{font-size:11px;color:#666}}
 .rbody div{{margin:2px 0}} .phone em{{color:#666;font-style:normal;font-size:12px}}
 .src{{font-size:11px;color:#888}} .actions{{margin-top:6px}}
 button{{cursor:pointer;border:1px solid #ccc;background:#fafafa;border-radius:6px;padding:3px 10px;margin-right:6px}}
 .state{{font-weight:600}} .st-verify{{color:#2e7d32}} .st-needsfix{{color:#c62828}}
 [data-conf][hidden]{{display:none}}
</style></head><body>
<header>
 <b>Wellbeing Resources — Coverage</b> · {count} jurisdictions
 &nbsp; filter:
 <label><input type=checkbox class=cf value=HIGH checked>HIGH</label>
 <label><input type=checkbox class=cf value=MEDIUM checked>MEDIUM</label>
 <label><input type=checkbox class=cf value=LOW checked>LOW</label>
 <label><input type=checkbox class=cf value=NA checked>NA</label>
</header>
<div class="national"><h2>National safety net (always present)</h2>{nat}</div>
{''.join(blocks)}
<script>
 function mark(id,kind){{localStorage.setItem('wb:'+id,kind);render(id);}}
 function render(id){{var k=localStorage.getItem('wb:'+id)||'';var el=document.getElementById('st-'+id);
   if(el){{el.textContent=k?('→ '+k):'';el.className='state st-'+k;}}}}
 document.querySelectorAll('.resource').forEach(function(r){{render(r.dataset.id);}});
 function applyFilters(){{var on={{}};document.querySelectorAll('.cf').forEach(function(c){{on[c.value]=c.checked;}});
   document.querySelectorAll('.resource').forEach(function(r){{r.hidden=!on[r.dataset.conf];}});}}
 document.querySelectorAll('.cf').forEach(function(c){{c.addEventListener('change',applyFilters);}});
</script>
</body></html>"""
    (ROOT / "viewer.html").write_text(page, encoding="utf-8")
    print(f"built viewer.html for {count} jurisdictions + {len(data.get('national', []))} national")


if __name__ == "__main__":
    main()
