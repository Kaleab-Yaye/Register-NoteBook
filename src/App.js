import React, { useEffect, useRef, useState } from "react";
import "./index.css";

// === 1. SHARED UTILITIES & SETUP ===

const DB_NAME = "re-toolkit-db";
const DB_VERSION = 1;
const STORE_NAME = "data_store";
const DATA_KEY = "app_data";

// --- IndexedDB Functions ---
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getDBData() {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(DATA_KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.error("DB Error", e);
    return [];
  }
}

async function setDBData(data) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(data, DATA_KEY);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.error("DB Write Error", e);
  }
}

// --- General Helpers ---
const uid = () => Math.random().toString(36).slice(2, 9);

function shallowCopyState(s) {
  try {
    if (typeof structuredClone === "function") return structuredClone(s);
  } catch (e) { }
  return JSON.parse(JSON.stringify(s || {}));
}

// === 2. DATA STRUCTURE FACTORIES ===
function createNewMethod(name = "new_method") {
  const method = {
    id: `meth_${uid()}`,
    name: name,
    params: 1,
    locals: 4,
    liveState: {},
    snapshots: {},
    lines: [],
    lastSavedAt: Date.now(),
  };
  for (let i = 0; i < method.params; i++) method.liveState[`p${i}`] = null;
  for (let i = 0; i < method.locals; i++) method.liveState[`v${i}`] = null;
  for (let i = 0; i < 8; i++)
    method.lines.push({ id: uid(), index: i + 1, notes: "", script: "" });
  recomputeAllSnapshots(method);
  return method;
}

function createNewClass({ realName, obfuscatedName, friendlyName }) {
  return {
    id: `cls_${uid()}`,
    realName,
    obfuscatedName,
    friendlyName,
    createdAt: Date.now(),
    methods: [],
  };
}

// --- Notebook-specific Logic ---
function parseValueToken(tok) {
  const t = tok?.trim?.();
  if (t === undefined) return null;
  if (t === "null") return null;
  if (t === "true") return true;
  if (t === "false") return false;
  if (/^\d+$/.test(t)) return Number(t);
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))
    return t.slice(1, -1);
  return t;
}

function isReg(s) {
  return /^(v|p)\d+$/.test(String(s || "").trim());
}

function recomputeAllSnapshots(method) {
  const initialLiveState = shallowCopyState(method.liveState || {});
  // Ensure regs exist
  for (let i = 0; i < (method.params || 0); i++) if (!(`p${i}` in initialLiveState)) initialLiveState[`p${i}`] = null;
  for (let i = 0; i < (method.locals || 0); i++) if (!(`v${i}` in initialLiveState)) initialLiveState[`v${i}`] = null;

  let currentRegs = shallowCopyState(initialLiveState);
  const newSnapshots = {};

  const sortedLines = [...(method.lines || [])].sort((a, b) => Number(a.index) - Number(b.index));

  for (const line of sortedLines) {
    const script = String(line.script || "").trim();
    if (script.length) {
      const statements = script.split(/[;\n]+/).map((s) => s.trim()).filter(Boolean);
      for (const stmt of statements) {
        const match = stmt.match(/^((?:v|p)\d+)\s*=\s*(.+)$/);
        if (match) {
          const reg = match[1].trim();
          const rhs = match[2].trim();
          currentRegs[reg] = parseValueToken(rhs);
        }
      }
    }
    newSnapshots[Number(line.index)] = shallowCopyState(currentRegs);
  }

  method.snapshots = newSnapshots;
  method.liveState = shallowCopyState(currentRegs);
}

// === 3. UI COMPONENTS ===
function Button({ children, onClick, disabled = false, variant = 'primary', className = '' }) {
  const baseStyle = {
    padding: "6px 12px",
    borderRadius: "0",
    fontWeight: 400,
    fontSize: "12px",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.4 : 1,
    transition: "none",
    border: "1px solid #333",
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'var(--font-mono)',
    textTransform: 'lowercase'
  };

  const variants = {
    primary: { background: "#1a1a1a", color: "#ccc" },
    secondary: { background: "#111", color: "#888", border: "1px solid #222" },
    danger: { background: "#1a1a1a", color: "#888", border: "1px solid #333" }
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{ ...baseStyle, ...variants[variant] }}
      className={className}
    >
      {children}
    </button>
  );
}

function TextInput({ value, onChange, placeholder, autoFocus }) {
  return (
    <input
      type="text"
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className="glass-panel"
      autoFocus={autoFocus}
      style={{
        width: '100%',
        padding: '8px',
        borderRadius: '0',
        color: '#ccc',
        fontSize: '12px',
        fontFamily: 'var(--font-mono)',
        background: '#111'
      }}
    />
  );
}

function Modal({ children, onClose }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
    }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ padding: '20px', background: '#111', border: '1px solid #222', width: '380px' }}>
        {children}
      </div>
    </div>
  );
}

// === 4. VIEWS ===

// --- View 1: Class List View ---
function ClassListView({ classes, onSelectClass, onCreateClass }) {
  const [isAdding, setIsAdding] = useState(false);
  const [newClass, setNewClass] = useState({ realName: "", obfuscatedName: "", friendlyName: "" });

  function handleCreate() {
    if (!newClass.realName.trim() || !newClass.friendlyName.trim()) {
      alert("Real Name and Friendly Name are required.");
      return;
    }
    onCreateClass(newClass);
    setIsAdding(false);
  }

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', borderBottom: '1px solid #222', paddingBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '16px', fontWeight: 400, color: '#888', margin: 0, letterSpacing: '2px', textTransform: 'uppercase' }}>register notebook</h1>
          <p style={{ color: '#444', fontSize: '11px', marginTop: '4px' }}>// smali register tracking</p>
        </div>
        <Button onClick={() => { setNewClass({ realName: "", obfuscatedName: "", friendlyName: "" }); setIsAdding(true); }}>
          + new class
        </Button>
      </div>

      {classes.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 0', color: '#444', border: '1px dashed #222' }}>
          <div style={{ fontSize: '12px', marginBottom: '8px' }}>[ empty ]</div>
          <div style={{ fontSize: '11px' }}>no classes tracked</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', background: '#222' }}>
          {classes.map((cls) => (
            <div
              key={cls.id}
              onClick={() => onSelectClass(cls.id)}
              style={{
                padding: '12px 16px',
                background: '#0f0f0f',
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <div>
                <div style={{ fontSize: '13px', color: '#aaa' }}>{cls.friendlyName}</div>
                <div style={{ fontSize: '10px', color: '#555', marginTop: '2px', fontFamily: 'var(--font-mono)' }}>{cls.realName}</div>
              </div>
              <div style={{ fontSize: '10px', color: '#444' }}>
                {cls.methods.length} methods
              </div>
            </div>
          ))}
        </div>
      )}

      {isAdding && (
        <Modal onClose={() => setIsAdding(false)}>
          <h2 style={{ fontSize: '13px', fontWeight: 400, marginBottom: '16px', color: '#888', textTransform: 'uppercase', letterSpacing: '1px' }}>track new class</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '10px', marginBottom: '4px', color: '#555', textTransform: 'uppercase' }}>friendly name</label>
              <TextInput value={newClass.friendlyName} onChange={(e) => setNewClass({ ...newClass, friendlyName: e.target.value })} placeholder="RootCheckService" autoFocus />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '10px', marginBottom: '4px', color: '#555', textTransform: 'uppercase' }}>class path</label>
              <TextInput value={newClass.realName} onChange={(e) => setNewClass({ ...newClass, realName: e.target.value })} placeholder="Lcom/example/MainActivity;" />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '10px', marginBottom: '4px', color: '#555', textTransform: 'uppercase' }}>obfuscated (optional)</label>
              <TextInput value={newClass.obfuscatedName} onChange={(e) => setNewClass({ ...newClass, obfuscatedName: e.target.value })} placeholder="a.b.c" />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '20px' }}>
            <Button variant="secondary" onClick={() => setIsAdding(false)}>cancel</Button>
            <Button onClick={handleCreate}>create</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// --- Class Detail View ---
function ClassDetailView({ classObject, onBack, onSelectMethod, onCreateMethod }) {
  const [newMethodName, setNewMethodName] = useState("");

  function handleCreate() {
    if (!newMethodName.trim()) {
      alert("Method name cannot be empty.");
      return;
    }
    onCreateMethod(newMethodName);
    setNewMethodName("");
  }

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto' }}>
      <div style={{ marginBottom: '24px' }}>
        <button onClick={onBack} style={{ marginBottom: '12px', background: 'none', border: 'none', cursor: 'pointer', color: '#666', fontSize: '11px', padding: 0 }}>
          {'<'} back
        </button>
        <h1 style={{ fontSize: '14px', fontWeight: 400, margin: '0 0 4px 0', color: '#aaa' }}>{classObject.friendlyName}</h1>
        <p style={{ fontFamily: 'var(--font-mono)', color: '#444', fontSize: '10px', margin: 0 }}>
          {classObject.realName}
        </p>
      </div>

      <div style={{ padding: '12px', background: '#111', border: '1px solid #222', marginBottom: '20px' }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          <div style={{ flex: 1 }}>
            <TextInput
              value={newMethodName}
              onChange={(e) => setNewMethodName(e.target.value)}
              placeholder="method name"
            />
          </div>
          <Button onClick={handleCreate}>add</Button>
        </div>
      </div>

      <div>
        <h2 style={{ fontSize: '10px', fontWeight: 400, marginBottom: '12px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px' }}>methods</h2>
        {classObject.methods.length === 0 ? (
          <div style={{ color: '#444', textAlign: 'center', padding: '32px 0', border: '1px dashed #222', fontSize: '11px' }}>
            no methods
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', background: '#222' }}>
            {classObject.methods.map((method) => (
              <div
                key={method.id}
                onClick={() => onSelectMethod(method.id)}
                style={{ padding: '10px 12px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#0f0f0f' }}
              >
                <div style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', color: '#aaa' }}>{method.name}</div>
                <div style={{ fontSize: '10px', color: '#444' }}>
                  p{method.params} v{method.locals} L{method.lines.length}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Live Grid ---
function LiveGrid({ liveState, onPick }) {
  const regs = Object.keys(liveState || {}).sort((a, b) => {
    const typeA = a.startsWith("p") ? 0 : 1;
    const typeB = b.startsWith("p") ? 0 : 1;
    if (typeA !== typeB) return typeA - typeB;
    return Number(a.slice(1)) - Number(b.slice(1));
  });

  return (
    <div style={{ padding: '12px', border: '1px solid #222', marginBottom: '12px', background: '#0c0c0c' }}>
      <div style={{ fontSize: '10px', fontWeight: 400, color: '#555', marginBottom: '10px', letterSpacing: '1px', textTransform: 'uppercase' }}>registers</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: '6px' }}>
        {regs.map((r) => {
          const val = liveState[r];
          const isNull = val === null || val === undefined;
          return (
            <div key={r} style={{
              minWidth: '70px',
              background: '#111',
              padding: '6px 8px',
              border: '1px solid #1a1a1a',
              opacity: isNull ? 0.5 : 1
            }}>
              <div style={{ fontSize: '9px', color: '#555', textTransform: 'uppercase' }}>{r}</div>
              <button
                onClick={() => onPick(r)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left', width: '100%',
                  marginTop: '2px',
                  fontFamily: 'var(--font-mono)', fontSize: '11px', color: isNull ? '#333' : '#888',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                }}
              >
                {JSON.stringify(val) ?? "null"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// === AutosizeTextarea ===
function AutosizeTextarea({ value, onChange, onKeyDown, onBlur, placeholder, style, "data-field": dataField }) {
  const textareaRef = useRef(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [value]);

  return (
    <textarea
      ref={textareaRef}
      value={value}
      onChange={onChange}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      placeholder={placeholder}
      data-field={dataField}
      style={{
        ...style,
        overflow: 'hidden',
        resize: 'none',
        background: 'transparent',
        border: 'none',
        color: 'inherit',
        outline: 'none',
        width: '100%'
      }}
    />
  );
}

// --- NotebookLine ---
function NotebookLine({ line, onUpdate, onKeyDown, setRegisterHover, snapshot }) {
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [isEditingScript, setIsEditingScript] = useState(false);
  const notesTextareaRef = useRef(null);
  const scriptTextareaRef = useRef(null);

  useEffect(() => {
    if (isEditingScript && scriptTextareaRef.current) {
      scriptTextareaRef.current.focus();
    }
  }, [isEditingScript]);

  useEffect(() => {
    if (isEditingNotes && notesTextareaRef.current) {
      notesTextareaRef.current.focus();
    }
  }, [isEditingNotes]);

  const renderNotes = () => {
    if (!line.notes) {
      return <span style={{ color: '#333', fontStyle: 'normal', fontSize: '11px' }}>...</span>;
    }
    return line.notes.split(/(\b(?:v|p)\d+\b)/g).map((part, i) => {
      if (isReg(part)) {
        return (
          <span
            key={i}
            onMouseEnter={(e) => {
              if (isEditingNotes) return;
              const rect = e.target.getBoundingClientRect();
              setRegisterHover({
                reg: part,
                line: line.index,
                value: snapshot ? snapshot[part] : undefined,
                x: rect.left,
                y: rect.top - 40,
              });
            }}
            style={{
              padding: "0 3px",
              fontFamily: 'var(--font-mono)', fontSize: '11px',
              background: "#1a1a1a", color: "#777",
              margin: '0 1px'
            }}
          >
            {part}
          </span>
        );
      }
      return part;
    });
  };

  return (
    <div
      style={{ display: "grid", gridTemplateColumns: "24px 1fr 1fr", gap: '12px', alignItems: "start", padding: '8px 12px', borderBottom: "1px solid #1a1a1a" }}
      onMouseLeave={() => setRegisterHover(null)}
    >
      <div style={{ fontSize: '10px', color: '#333', paddingTop: '8px', fontFamily: 'var(--font-mono)' }}>{line.index}</div>

      {/* Notes Column - First */}
      <div style={{ position: "relative", minHeight: '50px' }}>
        {isEditingNotes ? (
          <div style={{ background: '#0c0c0c', border: '1px solid #1a1a1a', padding: '6px 8px' }}>
            <AutosizeTextarea
              data-field="notes"
              placeholder="notes"
              value={line.notes}
              onChange={(e) => onUpdate({ notes: e.target.value })}
              onKeyDown={(e) => {
                if ((e.key === "Enter" && !e.shiftKey) || e.key === "Escape") {
                  setIsEditingNotes(false);
                }
                if (typeof onKeyDown === "function") onKeyDown(e, line.id, 'notes');
              }}
              onBlur={() => setIsEditingNotes(false)}
              ref={notesTextareaRef}
              style={{ fontSize: '11px', lineHeight: '1.5', color: '#666' }}
            />
          </div>
        ) : (
          <div
            style={{ padding: '6px 8px', cursor: 'pointer', minHeight: '50px', fontSize: '11px', lineHeight: '1.5', color: '#666' }}
            onClick={() => { setIsEditingNotes(true); setRegisterHover(null); }}
          >
            {renderNotes()}
          </div>
        )}
      </div>

      {/* Script Column - Second */}
      <div style={{ background: '#0c0c0c', border: '1px solid #1a1a1a', padding: '6px 8px', minHeight: '50px' }}>
        {isEditingScript ? (
          <AutosizeTextarea
            ref={scriptTextareaRef}
            data-field="script"
            placeholder='v0 = 100'
            value={line.script}
            onChange={(e) => onUpdate({ script: e.target.value })}
            onKeyDown={(e) => {
              if ((e.key === "Enter" && !e.shiftKey) || e.key === "Escape") {
                setIsEditingScript(false);
              }
              if (typeof onKeyDown === "function") onKeyDown(e, line.id, 'script');
            }}
            onBlur={() => setIsEditingScript(false)}
            style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', lineHeight: '1.5', color: '#888' }}
          />
        ) : (
          <div
            onClick={() => { setIsEditingScript(true); setRegisterHover(null); }}
            style={{ cursor: 'text', minHeight: '38px', fontFamily: 'var(--font-mono)', fontSize: '11px', lineHeight: '1.5', whiteSpace: 'pre-wrap', color: '#888' }}
          >
            {line.script ? line.script.split(/(\b(?:v|p)\d+\b)/g).map((part, i) => {
              if (isReg(part)) {
                return (
                  <span
                    key={i}
                    onMouseEnter={(e) => {
                      if (isEditingScript) return;
                      const rect = e.target.getBoundingClientRect();
                      setRegisterHover({
                        reg: part,
                        line: line.index,
                        value: snapshot ? snapshot[part] : undefined,
                        x: rect.left,
                        y: rect.top - 40,
                      });
                    }}
                    style={{
                      padding: "0 3px",
                      background: "#1a1a1a", color: "#777",
                      margin: '0 1px'
                    }}
                  >
                    {part}
                  </span>
                );
              }
              return part;
            }) : <span style={{ color: '#333' }}>...</span>}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Method Notebook View ---
function MethodNotebookView({ methodObject, onBack, onUpdateMethod }) {
  const [method, setMethod] = useState(shallowCopyState(methodObject));
  const [pickedReg, setPickedReg] = useState(null);
  const [registerHover, setRegisterHover] = useState(null);
  const [importTrigger, setImportTrigger] = useState(0);

  useEffect(() => {
    setMethod(shallowCopyState(methodObject));
  }, [methodObject]);

  useEffect(() => {
    const copy = shallowCopyState(method);
    recomputeAllSnapshots(copy);
    setMethod(copy);
  }, [JSON.stringify((method.lines || []).map(l => ({ id: l.id, index: l.index, script: l.script })))]);

  useEffect(() => {
    const t = setTimeout(() => {
      onUpdateMethod(method);
    }, 300);
    return () => clearTimeout(t);
  }, [method]);

  function updateLine(lineId, patch) {
    setMethod((prev) => {
      const newLines = prev.lines.map((l) => (l.id === lineId ? { ...l, ...patch } : l));
      return { ...prev, lines: newLines, lastSavedAt: Date.now() };
    });
  }

  function handleLineKeyDown(e, lineId, field) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      setTimeout(() => {
        setMethod((prev) => {
          const currentIndex = prev.lines.findIndex(l => l.id === lineId);
          if (currentIndex === -1) return prev;
          if (currentIndex === prev.lines.length - 1) {
            const newIndex = prev.lines.length > 0 ? Math.max(...prev.lines.map(l => Number(l.index))) + 1 : 1;
            const newLine = { id: uid(), index: newIndex, notes: "", script: "" };
            const updated = { ...prev, lines: [...prev.lines, newLine] };
            setTimeout(() => {
              const container = document.querySelector(`div[data-line-id="${newLine.id}"]`);
              if (container) {
                const nextInput = container.querySelector(`textarea[data-field="${field}"]`);
                if (nextInput) nextInput.focus();
              }
            }, 50);
            return updated;
          } else {
            const nextLine = prev.lines[currentIndex + 1];
            setTimeout(() => {
              const container = document.querySelector(`div[data-line-id="${nextLine.id}"]`);
              if (container) {
                const nextInput = container.querySelector(`textarea[data-field="${field}"]`);
                if (nextInput) nextInput.focus();
              }
            }, 50);
            return prev;
          }
        });
      }, 0);
    } else if (e.key === "Escape") {
      e.target.blur?.();
    }
  }

  function addRegister(type) {
    setMethod((prev) => {
      const copy = shallowCopyState(prev);
      if (type === 'v') {
        copy.locals = (copy.locals || 0) + 1;
        copy.liveState[`v${copy.locals - 1}`] = null;
      } else if (type === 'p') {
        copy.params = (copy.params || 0) + 1;
        copy.liveState[`p${copy.params - 1}`] = null;
      }
      recomputeAllSnapshots(copy);
      return copy;
    });
  }

  function exportJSON() {
    const data = JSON.stringify(method, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${method.name}-notebook.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importJSON(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const importedMethod = JSON.parse(String(reader.result));
        if (importedMethod && importedMethod.lines && importedMethod.name) {
          setMethod(prev => ({ ...importedMethod, id: prev.id }));
          setImportTrigger(prev => prev + 1);
        } else {
          alert("Invalid method notebook file.");
        }
      } catch (e) {
        alert("Invalid JSON file.");
      }
    };
    reader.readAsText(file);
  }

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", gap: '12px', overflow: 'hidden', padding: '12px', boxSizing: 'border-box', background: '#0a0a0a' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '10px', borderBottom: '1px solid #1a1a1a' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#555', fontSize: '11px', padding: 0 }}>
            {'<'} back
          </button>
          <div style={{ height: '12px', width: '1px', background: '#222' }}></div>
          <div style={{ fontWeight: 400, fontSize: '13px', color: '#888' }}>{method.name}</div>
        </div>

        <div style={{ display: "flex", gap: '6px' }}>
          <Button variant="secondary" onClick={() => addRegister('v')}>+v</Button>
          <Button variant="secondary" onClick={() => addRegister('p')}>+p</Button>
          <Button variant="secondary" onClick={exportJSON}>export</Button>
          <label style={{ cursor: 'pointer', display: 'flex' }}>
            <div style={{ padding: "6px 12px", fontWeight: 400, fontSize: "11px", background: "#111", color: "#666", border: "1px solid #222", fontFamily: 'var(--font-mono)' }}>import</div>
            <input type="file" accept="application/json" style={{ display: "none" }} key={importTrigger}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importJSON(f);
              }}
            />
          </label>
        </div>
      </div>

      <div style={{ display: "flex", gap: '12px', flex: 1, overflow: 'hidden' }}>
        {/* Main Notebook Area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
          <LiveGrid liveState={method.liveState} onPick={setPickedReg} />

          <div style={{ flex: 1, border: '1px solid #1a1a1a', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#0c0c0c' }}>
            <div style={{ padding: '8px 12px', borderBottom: "1px solid #1a1a1a", background: '#080808', display: 'grid', gridTemplateColumns: '24px 1fr 1fr', gap: '12px', fontSize: '9px', fontWeight: 400, color: '#444', textTransform: 'uppercase', letterSpacing: '1px' }}>
              <div>#</div>
              <div>notes</div>
              <div>script</div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {(method.lines || []).sort((a, b) => Number(a.index) - Number(b.index)).map((line) => (
                <div key={line.id} data-line-id={line.id}>
                  <NotebookLine
                    line={line}
                    snapshot={method.snapshots ? method.snapshots[Number(line.index)] : {}}
                    onUpdate={(patch) => updateLine(line.id, patch)}
                    onKeyDown={handleLineKeyDown}
                    setRegisterHover={setRegisterHover}
                  />
                </div>
              ))}
              <div style={{ padding: '16px', textAlign: 'center' }}>
                <Button variant="secondary" onClick={() => {
                  setMethod(prev => {
                    const newIndex = prev.lines.length > 0 ? Math.max(...prev.lines.map(l => Number(l.index))) + 1 : 1;
                    const newLine = { id: uid(), index: newIndex, notes: "", script: "" };
                    return { ...prev, lines: [...prev.lines, newLine], lastSavedAt: Date.now() };
                  })
                }}>+ line</Button>
              </div>
            </div>
          </div>
        </div>

        {/* Inspector Sidebar */}
        <div style={{ width: '220px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ padding: '12px', border: '1px solid #1a1a1a', flex: 1, background: '#0c0c0c' }}>
            <div style={{ fontSize: '9px', fontWeight: 400, color: '#444', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '1px' }}>inspector</div>
            {pickedReg ? (
              <>
                <div style={{ fontSize: '13px', color: '#777', marginBottom: '6px', fontFamily: 'var(--font-mono)' }}>{pickedReg}</div>
                <div style={{ fontSize: '9px', color: '#444', margin: '12px 0 4px 0', textTransform: 'uppercase' }}>value</div>
                <div style={{ padding: '8px', background: '#111', border: '1px solid #1a1a1a', fontFamily: 'var(--font-mono)', wordBreak: 'break-all', fontSize: '11px', color: '#666' }}>
                  {JSON.stringify(method.liveState[pickedReg])}
                </div>
              </>
            ) : (
              <div style={{ color: '#333', fontSize: '10px', lineHeight: '1.4' }}>
                click register to inspect
              </div>
            )}
          </div>
        </div>
      </div>

      {registerHover && (
        <div style={{
          position: "fixed", left: registerHover.x, top: registerHover.y,
          background: "#111", border: "1px solid #333",
          color: "#888", padding: "6px 10px",
          fontSize: "10px", fontFamily: "var(--font-mono)",
          zIndex: 2000, pointerEvents: "none",
          maxWidth: '240px', wordBreak: 'break-word'
        }}>
          <div style={{ color: '#666', marginBottom: '2px' }}>{registerHover.reg} @L{registerHover.line}</div>
          <div style={{ color: '#888' }}>{JSON.stringify(registerHover.value)}</div>
        </div>
      )}
    </div>
  );
}

// === 5. APP ENTRY ===

export default function App() {
  const [classes, setClasses] = useState([]);
  const [currentView, setCurrentView] = useState({ view: 'classList' });

  useEffect(() => {
    (async () => {
      const data = await getDBData();
      if (data) setClasses(data);
    })();
  }, []);

  useEffect(() => {
    const handler = setTimeout(() => {
      if (classes.length > 0) setDBData(classes);
    }, 1000);
    return () => clearTimeout(handler);
  }, [classes]);

  function handleCreateClass(classData) {
    setClasses(prev => [...prev, createNewClass(classData)]);
  }

  function handleCreateMethod(classId, methodName) {
    setClasses(prev => prev.map(cls => cls.id === classId ? { ...cls, methods: [...cls.methods, createNewMethod(methodName)] } : cls));
  }

  function handleUpdateMethod(updatedMethod) {
    setClasses(prev => prev.map(cls => {
      const idx = cls.methods.findIndex(m => m.id === updatedMethod.id);
      if (idx === -1) return cls;
      const newMethods = [...cls.methods];
      newMethods[idx] = updatedMethod;
      return { ...cls, methods: newMethods };
    }));
  }

  function renderCurrentView() {
    if (currentView.view === 'methodNotebook') {
      const cls = classes.find(c => c.id === currentView.classId);
      const method = cls?.methods.find(m => m.id === currentView.methodId);
      if (!method) return setCurrentView({ view: 'classList' });
      return <MethodNotebookView methodObject={method} onUpdateMethod={handleUpdateMethod} onBack={() => setCurrentView({ view: 'classDetail', classId: cls.id })} />;
    }
    if (currentView.view === 'classDetail') {
      const cls = classes.find(c => c.id === currentView.classId);
      if (!cls) return setCurrentView({ view: 'classList' });
      return <ClassDetailView
        classObject={cls}
        onBack={() => setCurrentView({ view: 'classList' })}
        onCreateMethod={(name) => handleCreateMethod(cls.id, name)}
        onSelectMethod={(mId) => setCurrentView({ view: 'methodNotebook', classId: cls.id, methodId: mId })}
      />;
    }
    return <ClassListView classes={classes} onCreateClass={handleCreateClass} onSelectClass={(id) => setCurrentView({ view: 'classDetail', classId: id })} />;
  }

  return (
    <div style={{ minHeight: '100vh', padding: currentView.view === 'methodNotebook' ? 0 : '40px' }}>
      {renderCurrentView()}
    </div>
  );
}