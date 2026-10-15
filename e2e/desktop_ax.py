"""Drive the real desktop app through macOS Accessibility (System Events). macOS only; needs Accessibility permission
for the terminal that runs it. Elements are found by role and visible title, like a person reading the screen."""
import json, subprocess, time

PROC = "mon-spire-editor"

def _jxa(body: str):
    script = f'''
    const se = Application("System Events"); se.includeStandardAdditions = true;
    const proc = se.processes.byName("{PROC}");
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
    subprocess.run(["osascript", "-e", f'tell application "System Events" to set frontmost of process "{PROC}" to true'], check=False)
    time.sleep(0.4)

def click(title, role="AXButton", nth=0):
    r = _jxa(f'const e = find({json.dumps(role)}, {json.dumps(title)}, {nth}); if (!e) "MISSING"; else {{ e.actions.byName("AXPress").perform(); "ok"; }}')
    if r == "MISSING": raise LookupError(f"no {role} titled {title!r}")
    time.sleep(0.5)

def texts():
    """Every static text and button label currently on screen, in order."""
    return json.loads(_jxa('JSON.stringify(win().entireContents().filter(e => ["AXStaticText","AXButton","AXHeading","AXTextField","AXCheckBox"].includes(role(e))).map(e => role(e).slice(2) + ": " + label(e)))'))

def has(text):
    return any(text in t for t in texts())

def fields():
    return json.loads(_jxa('JSON.stringify(win().entireContents().filter(e => ["AXTextField","AXTextArea"].includes(role(e))).map(e => { let ph = ""; try { ph = e.attributes.byName("AXPlaceholderValue").value(); } catch (x) {} return [role(e), ph, label(e)]; }))'))

def type_into(placeholder, text):
    """Focus the text field that has this placeholder and type like a person would."""
    r = _jxa(f'''let target = null;
      for (const e of win().entireContents()) {{
        if (role(e) !== "AXTextField") continue;
        let ph = ""; try {{ ph = e.attributes.byName("AXPlaceholderValue").value(); }} catch (x) {{}}
        if (ph.indexOf({json.dumps(placeholder)}) !== -1) {{ target = e; break; }}
      }}
      if (!target) "MISSING"; else {{ target.focused = true; "ok"; }}''')
    if r == "MISSING": raise LookupError(f"no text field with placeholder {placeholder!r}")
    time.sleep(0.3)
    _jxa(f'se.keystroke({json.dumps(text)}); "ok"')
    time.sleep(0.4)
