"""Downloads the photographic skies (Poly Haven, CC0) used by RailSaver.

Run by .github/workflows/skies.yml, which stores the result on the
`sky-assets` branch (kept out of the main history because of its size).

  python tools/fetch_skies.py OUTDIR            # the skies listed in tools/skies.json
  python tools/fetch_skies.py OUTDIR --catalog  # also write the full HDRI catalogue

For each sky: <id>.jpg (4096x2048 tonemapped background) and <id>_1k.hdr
(lighting and reflections).
"""
import io, json, os, sys, urllib.request

API = "https://api.polyhaven.com"
UA = {"User-Agent": "RailSaver-build (+https://github.com/vagdesign/RailSaver)"}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
        return r.read()


def main():
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    if "--catalog" in sys.argv:
        cat = json.loads(get(f"{API}/assets?t=hdris"))
        slim = {k: {"name": v.get("name"), "categories": v.get("categories"), "tags": v.get("tags"),
                    "evs": v.get("evs_cap"), "wb": v.get("whitebalance")} for k, v in cat.items()}
        with open(os.path.join(out, "catalog.json"), "w") as f:
            json.dump(slim, f, indent=0, sort_keys=True)
        print(len(slim), "HDRIs in catalogue")

    from PIL import Image
    Image.MAX_IMAGE_PIXELS = None
    here = os.path.dirname(os.path.abspath(__file__))
    wanted = json.load(open(os.path.join(here, "skies.json")))
    ok = {}
    for key, spec in wanted.items():
        pid = spec["polyhaven"]
        try:
            files = json.loads(get(f"{API}/files/{pid}"))
            hdr = files["hdri"]["1k"]["hdr"]["url"]
            open(os.path.join(out, f"{pid}_1k.hdr"), "wb").write(get(hdr))
            tm = (files.get("tonemapped") or {}).get("url")
            if tm:
                im = Image.open(io.BytesIO(get(tm))).convert("RGB")
                im = im.resize((4096, 2048), Image.LANCZOS)
                im.save(os.path.join(out, f"{pid}.jpg"), quality=88, optimize=True, progressive=True)
            else:
                print("no tonemapped JPG for", pid, "keys:", list(files))
            ok[key] = pid
            print("ok", key, pid)
        except Exception as e:  # keep going; the page falls back to the generated sky
            print("FAILED", key, pid, e)
    with open(os.path.join(out, "fetched.json"), "w") as f:
        json.dump(ok, f, indent=1)


if __name__ == "__main__":
    main()
