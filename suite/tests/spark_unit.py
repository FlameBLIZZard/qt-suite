"""Unit checks for spark.py (loop 4): store validation, safe unzip, downloads list, CPU/RAM, link checks.
python suite\\tests\\spark_unit.py   (writes only into a temp folder)"""
import os
import shutil
import sys
import tempfile
import time
import zipfile

TMP = tempfile.mkdtemp(prefix="qt-spark-")
os.environ["QT_SUITE_DATA"] = os.path.join(TMP, "data")
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import spark  # noqa: E402

fails = 0


def check(name, ok):
    global fails
    print(("PASS  " if ok else "FAIL  ") + name)
    fails += 0 if ok else 1


try:
    # store: bad pins dropped, notes capped and given ids, saved to disk
    s = spark.save_store({"pins": ["relative\\x", {"path": "C:\\Windows"}, {"path": "c:\\windows"}, 5, {"path": "\\\\nas\\share"}],
                          "notes": [{"text": "a" * 60000}, {"id": "../bad", "text": "x"}, "junk"]})
    check("pins keep only full paths, no duplicates", [p["path"] for p in s["pins"]] == ["C:\\Windows", "\\\\nas\\share"])
    check("notes get ids and are capped", len(s["notes"]) == 2 and len(s["notes"][0]["text"]) == 50000 and s["notes"][1]["id"] != "../bad")
    check("store is saved to disk", os.path.isfile(spark.STORE))
    check("unknown keys are ignored", "evil" not in spark.save_store({"evil": 1}))

    # unzip: never escapes the new folder, never overwrites
    z = os.path.join(TMP, "pack.zip")
    with zipfile.ZipFile(z, "w") as f:
        f.writestr("a.txt", "A")
        f.writestr("sub/b.txt", "B")
        f.writestr("../escape.txt", "no")
        f.writestr("/abs.txt", "no")
    code, r = spark.extract(z)
    check("unzip works", code == 200 and r["files"] >= 2 and os.path.isfile(os.path.join(TMP, "pack", "sub", "b.txt")))
    check("zip-slip entry stays out of the parent folder", not os.path.exists(os.path.join(TMP, "escape.txt")))
    code2, r2 = spark.extract(z)
    check("second unzip goes to a new folder", code2 == 200 and r2["dir"].endswith("pack (2)"))
    code3, _ = spark.extract(os.path.join(TMP, "nope.zip"))
    check("missing zip refused", code3 == 400)

    # links: only http(s)
    for bad in ("javascript:alert(1)", "file:///C:/x", "", "notaurl"):
        if spark.grab(bad, "video")[0] != 400:
            check("bad link refused: " + bad, False)
            break
    else:
        check("non-web links refused", True)

    # downloads + sys
    d = spark.downloads()
    check("downloads list answers", "files" in d and all({"name", "path", "m"} <= set(x) for x in d["files"]))
    spark.init(lambda t: (False, "x"), {}, lambda p: False)
    time.sleep(2.3)
    sy = spark.sys_info()
    check("cpu sampled", sy["cpu"] is not None and 0 <= sy["cpu"] <= 100 and len(sy["cpuh"]) >= 1)
    check("memory + uptime", sy["mem"]["total"] > 0 and 0 < sy["mem"]["pct"] <= 100 and sy["up"] > 0)
    check("phone note needs text", spark.phone_note("  ")[0] == 400)
    st = spark.route_get("/api/spark/stat", {"path": ["C:\\Windows", "C:\\no-such-thing-qt"]})[1]["items"]
    check("stat tells folders from missing", st[0]["isdir"] and not st[1]["ok"])
finally:
    shutil.rmtree(TMP, ignore_errors=True)

print(f"{fails} FAILED" if fails else "ALL PASSED")
sys.exit(1 if fails else 0)
