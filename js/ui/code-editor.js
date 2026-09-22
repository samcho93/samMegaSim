// C source editor (CodeMirror 5, with textarea fallback)
const AVR_WORDS = ('DDRA DDRB DDRC DDRD DDRE DDRF DDRG PORTA PORTB PORTC PORTD PORTE PORTF PORTG PINA PINB PINC PIND PINE PINF PING ' +
  'TCCR0 TCCR0A TCCR0B TCCR1A TCCR1B TCCR2 TCCR2A TCCR2B TCNT0 TCNT1 TCNT2 OCR0 OCR0A OCR0B OCR1A OCR1B OCR2 OCR2A OCR2B TIMSK TIMSK0 TIMSK1 TIMSK2 TIFR ' +
  'UDR UDR0 UDR1 UCSRA UCSRB UCSRC UCSR0A UCSR0B UCSR0C UBRRL UBRRH UBRR0 UBRR0L UBRR0H ADMUX ADCSRA ADCL ADCH ADC SREG EICRA EIMSK GICR MCUCR ' +
  'SPCR SPSR SPDR TWBR TWCR TWSR TWDR ISR sei cli _delay_ms _delay_us F_CPU').split(' ');

export class CodeEditor {
  constructor(host, app) {
    this.host = host;
    this.app = app;
    this.docs = new Map(); // name -> CodeMirror.Doc
    this.current = null;
    this.markers = [];
    const CM = window.CodeMirror;
    if (CM) {
      this.cm = CM(host, {
        value: '', mode: 'text/x-csrc', theme: 'material-darker', lineNumbers: true, indentUnit: 4, tabSize: 4,
        indentWithTabs: false, matchBrackets: true, autoCloseBrackets: true, styleActiveLine: true,
        gutters: ['errs', 'CodeMirror-linenumbers'],
        extraKeys: {
          'Ctrl-/': 'toggleComment', 'Cmd-/': 'toggleComment',
          Tab: (cm) => (cm.somethingSelected() ? cm.indentSelection('add') : cm.replaceSelection('    ', 'end')),
          'Shift-Tab': (cm) => cm.indentSelection('subtract'),
          F7: () => app.cmd('build'), F5: () => app.cmd('run'), 'Ctrl-S': () => app.cmd('save'),
        },
      });
      this.cm.on('change', () => this._onChange());
      const style = document.createElement('style');
      style.textContent = '.cm-s-material-darker .cm-avr-reg{color:#ffcb6b}';
      document.head.appendChild(style);
      this.cm.addOverlay?.({
        token(stream) {
          if (stream.match(/^[A-Za-z_][A-Za-z0-9_]*/)) return AVR_WORDS.includes(stream.current()) ? 'avr-reg' : null;
          stream.next();
          return null;
        },
      });
    } else {
      this.ta = document.createElement('textarea');
      this.ta.className = 'fallback';
      this.ta.spellcheck = false;
      host.appendChild(this.ta);
      this.ta.addEventListener('input', () => this._onChange());
    }
  }

  setFiles(files) {
    this.docs.clear();
    this.files = files;
    if (this.cm) for (const f of files) this.docs.set(f.name, window.CodeMirror.Doc(f.content, 'text/x-csrc'));
    this.current = null;
  }

  show(name) {
    const f = this.files.find((x) => x.name === name);
    if (!f) return;
    this._sync();
    this.current = name;
    if (this.cm) {
      let d = this.docs.get(name);
      if (!d) { d = window.CodeMirror.Doc(f.content, 'text/x-csrc'); this.docs.set(name, d); }
      this.cm.swapDoc(d);
      setTimeout(() => this.cm.refresh(), 0);
    } else this.ta.value = f.content;
    this._applyMarkers();
  }

  refresh() { this.cm?.refresh(); }
  focus() { this.cm ? this.cm.focus() : this.ta.focus(); }

  _sync() {
    if (!this.current) return;
    const f = this.files.find((x) => x.name === this.current);
    if (!f) return;
    f.content = this.cm ? this.docs.get(this.current)?.getValue() ?? f.content : this.ta.value;
  }

  /** Write all editor contents back to the file list */
  syncAll() {
    if (this.cm) for (const f of this.files) { const d = this.docs.get(f.name); if (d) f.content = d.getValue(); }
    else this._sync();
  }

  _onChange() {
    this._sync();
    this.app.onCodeChange?.(this.current);
  }

  renameDoc(oldName, newName) {
    const d = this.docs.get(oldName);
    if (d) { this.docs.delete(oldName); this.docs.set(newName, d); }
    if (this.current === oldName) this.current = newName;
  }

  removeDoc(name) { this.docs.delete(name); if (this.current === name) this.current = null; }

  // --- diagnostics ---
  setDiagnostics(diags) {
    this.diags = diags || [];
    this._applyMarkers();
  }

  _applyMarkers() {
    if (!this.cm) return;
    for (const m of this.markers) {
      if (m.doc) { m.doc.removeLineClass(m.line, 'background', m.cls); }
    }
    this.markers = [];
    this.cm.clearGutter('errs');
    const d = this.docs.get(this.current);
    if (!d) return;
    for (const g of this.diags || []) {
      if (g.file !== this.current) continue;
      const line = Math.max(0, g.line - 1);
      const cls = g.kind === 'error' ? 'cm-err-line' : 'cm-warn-line';
      const h = d.addLineClass(line, 'background', cls);
      this.markers.push({ doc: d, line: h, cls });
      const mk = document.createElement('span');
      mk.className = g.kind === 'error' ? 'gut-err' : 'gut-warn';
      mk.textContent = g.kind === 'error' ? '●' : '▲';
      mk.title = g.msg;
      this.cm.setGutterMarker(line, 'errs', mk);
    }
  }

  gotoLine(name, line) {
    this.app.showCodeTab(name);
    if (this.cm) {
      this.cm.setCursor({ line: line - 1, ch: 0 });
      this.cm.scrollIntoView({ line: line - 1, ch: 0 }, 120);
      this.cm.focus();
    }
  }
}
