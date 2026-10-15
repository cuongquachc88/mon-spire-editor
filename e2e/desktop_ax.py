"""Drive the real desktop app through macOS Accessibility (System Events). macOS only; needs Accessibility permission
for the terminal that runs it. Elements are found by role and visible title and pressed with AXPress on that exact
process (chosen by PID). It never sends raw mouse or keyboard events: those go to whatever window is in front, which
may be someone's terminal."""
import json, os, subprocess, time

PROC = "mon-spire-editor"
# Several copies can run at once (a real session and a test); pick one by PID, never by name.
PID = int(os.environ["AX_PID"]) if os.environ.get("AX_PID") else None

def set_pid(pid): 
    global PID
    PID = pid

def _jxa(body: str):
    script = f'''
    const se = Application("System Events"); se.includeStandardAdditions = true;
    const proc = {"se.processes.whose({unixId: %d})[0]" % PID if PID else 'se.processes.byName("%s")' % PROC};
    function win() {{ return proc.windows[0]; }}
    function label(e) {{ try {{ return String(e.title() || e.description() || e.value() || ""); }} catch (x) {{ return ""; }} }}
    function role(e) {{ try {{ return e.role(); }} catch (x) {{ return ""; }} }}
    function find(r, text, nth) {{
      let n = 0;
      for (const e of win().entireContents()) {{
        if (role(e) === r && label(e).indexOf(text) !== -1) {{ if (n++ === (nth || 0)) return e; }}
      }}
      return null;
    }}
    {body}
    '''
    out = subprocess.run(["osascript", "-l", "JavaScript", "-e", script], capture_output=True, text=True, timeout=90)
    if out.returncode != 0: raise RuntimeError(out.stderr.strip()[:300])
    return out.stdout.strip()

def front():
    target = f"first process whose unix id is {PID}" if PID else f'process "{PROC}"'
    subprocess.run(["osascript", "-e", f'tell application "System Events" to set frontmost of ({target}) to true'], check=False)
    time.sleep(0.4)

def click(title, role="AXButton", nth=0, tries=10):
    """Press an element. The accessibility tree of a web view is read in pieces while the page updates, so an element
    can be missing from one read and present in the next: look again before giving up."""
    for attempt in range(tries):
        r = _jxa(f'const e = find({json.dumps(role)}, {json.dumps(title)}, {nth}); if (!e) "MISSING"; else {{ e.actions.byName("AXPress").perform(); "ok"; }}')
        if r != "MISSING":
            time.sleep(0.5)
            return
        time.sleep(0.6)
    raise LookupError(f"no {role} titled {title!r} after {tries} reads")

def _by_class(cls):
    return f'''let target = null, n = 0;
      for (const e of win().entireContents()) {{
        let c = ""; try {{ c = JSON.stringify(e.attributes.byName("AXDOMClassList").value()); }} catch (x) {{}}
        if (c.indexOf({json.dumps(chr(34) + cls + chr(34))}) !== -1) {{ target = e; break; }}
      }}'''

def click_class(cls, tries=10):
    """Press the element that has this CSS class (for controls whose accessibility name is empty or changing)."""
    for _ in range(tries):
        r = _jxa(_by_class(cls) + 'if (!target) "MISSING"; else { target.actions.byName("AXPress").perform(); "ok"; }')
        if r != "MISSING":
            time.sleep(0.5)
            return
        time.sleep(0.6)
    raise LookupError(f"no element with class {cls!r}")

def has_class(cls, reads=5):
    for _ in range(reads):
        if _jxa(_by_class(cls) + 'target ? "yes" : "no"') == "yes": return True
        time.sleep(0.5)
    return False

def frame(title, role="AXButton", tries=10):
    """(x, y, w, h) in screen points of the element with this title."""
    for _ in range(tries):
        r = _jxa(f'const e = find({json.dumps(role)}, {json.dumps(title)}, 0); if (!e) "MISSING"; else JSON.stringify([e.position()[0], e.position()[1], e.size()[0], e.size()[1]]);')
        if r != "MISSING": return json.loads(r)
        time.sleep(0.6)
    raise LookupError(f"no {role} titled {title!r}")

def texts():
    """Every static text and button label currently on screen, in order."""
    return json.loads(_jxa('JSON.stringify(win().entireContents().filter(e => ["AXStaticText","AXButton","AXHeading","AXTextField","AXCheckBox"].includes(role(e))).map(e => role(e).slice(2) + ": " + label(e)))'))

def has(text, reads=3):
    """True if any of a few reads shows the text (a single read of a live web view can be partial)."""
    for _ in range(reads):
        if any(text in t for t in texts()): return True
        time.sleep(0.4)
    return False

def fields():
    return json.loads(_jxa('JSON.stringify(win().entireContents().filter(e => ["AXTextField","AXTextArea"].includes(role(e))).map(e => { let ph = ""; try { ph = e.attributes.byName("AXPlaceholderValue").value(); } catch (x) {} return [role(e), ph, label(e)]; }))'))

def window_count():
    return int(_jxa("String(proc.windows.length)"))
