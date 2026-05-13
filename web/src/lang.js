import { StreamLanguage, HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as hTags } from '@lezer/highlight'
import { completeFromList, snippetCompletion } from '@codemirror/autocomplete'
import { linter } from '@codemirror/lint'

const ASM8085_MNEMONICS = new Set([
  'ACI','ADC','ADD','ADI','ANA','ANI','CALL','CC','CM','CMA','CMC','CMP','CNC','CNZ','CP','CPE','CPI','CPO','CZ',
  'DAA','DAD','DCR','DCX','DI','EI','HLT','IN','INR','INX','JC','JM','JMP','JNC','JNZ','JP','JPE','JPO','JZ',
  'LDA','LDAX','LHLD','LXI','MOV','MVI','NOP','ORA','ORI','OUT','PCHL','POP','PUSH','RAL','RAR','RC','RET','RIM','RLC',
  'RM','RNC','RNZ','RP','RPE','RPO','RRC','RST','RZ','SBB','SBI','SHLD','SIM','SPHL','STA','STAX','STC','SUB','SUI',
  'XCHG','XRA','XRI','XTHL',
])
const ASM8085_REGS      = new Set(['A','B','C','D','E','H','L','M','SP','PSW'])
const ASM8085_DIRECTIVES = new Set(['ORG','EQU','END','IF','ENDIF','MACRO','ENDM','SET'])
const ASM8085_DATA       = new Set(['DB','DW','DS'])
const ASM8085_PSEUDO    = new Set(['KICKOFF','ASSERT','SETBYTE','SETWORD'])
const ASM8085_UNSUPPORTED = new Set(['IF','ENDIF','MACRO','ENDM'])

const ASM8085_NO_OPERAND = new Set([
  'CMA','CMC','DAA','DI','EI','HLT','NOP','PCHL','RAL','RAR','RC','RET','RIM','RLC',
  'RM','RNC','RNZ','RP','RPE','RPO','RRC','RZ','SIM','SPHL','STC','XCHG','XTHL',
  'END'
])

const ASM8085_REQUIRES_COMMA = new Set(['MOV','MVI','LXI','SETBYTE','SETWORD','ASSERT'])

export const asm8085Lang = StreamLanguage.define({
  token(stream) {
    if (stream.eatSpace()) return null
    if (stream.eat(';')) { stream.skipToEnd(); return 'comment' }
    if (stream.match(/^[A-Za-z0-9_]+:/)) {
      // If the rest of the line is empty or just a comment, it's a standalone label
      if (stream.match(/^\s*(?:;.*)?$/, false)) return 'className'
      return 'labelName' // Otherwise, it's inline with an instruction
    }
    if (stream.match(/^[0-9A-Fa-f]+[Hh]\b/)) return 'number'
    if (stream.match(/^[01]+[Bb]\b/))         return 'number'
    if (stream.match(/^[0-9]+\b/))            return 'number'
    if (stream.match(/^'[^']*'/))             return 'string'
    if (stream.match(/^[A-Za-z_][A-Za-z0-9_]*/)) {
      const word = stream.current().toUpperCase()
      if (ASM8085_MNEMONICS.has(word))  return 'keyword'
      if (ASM8085_REGS.has(word))       return 'atom'
      if (ASM8085_DIRECTIVES.has(word)) return 'meta'
      if (ASM8085_DATA.has(word))       return 'type'
      if (ASM8085_PSEUDO.has(word))     return 'variable-2'
      return 'variableName'
    }
    stream.next()
    return null
  },
  languageData: {
    autocomplete: completeFromList([
      snippetCompletion('ORG ${1:0100H}', { label: 'ORG', detail: 'Set assembly origin', type: 'meta' }),
      snippetCompletion('${1:LABEL} EQU ${2:0FFH}', { label: 'EQU', detail: 'Equate a symbol to a constant', type: 'meta' }),
      snippetCompletion('KICKOFF ${1:0100H}', { label: 'KICKOFF', detail: 'Set execution start address', type: 'meta' }),
      snippetCompletion('ASSERT ${1:A}, ${2:42H}', { label: 'ASSERT', detail: 'Assert register/flag value', type: 'meta' }),
      snippetCompletion('ASSERT MEM, ${1:0100H}, ${2:0FFH}', { label: 'ASSERT MEM', detail: 'Assert memory byte value', type: 'meta' }),
      snippetCompletion('SETBYTE ${1:2000H}, ${2:0FFH}', { label: 'SETBYTE', detail: 'Set memory byte at assembly time', type: 'meta' }),
      snippetCompletion('SETWORD ${1:2000H}, ${2:1234H}', { label: 'SETWORD', detail: 'Set memory word at assembly time', type: 'meta' }),
      snippetCompletion('DB ${1:10H}, ${2:20H}, ${3:30H}', { label: 'DB', detail: 'Define Byte array', type: 'type' }),
      snippetCompletion('DB "${1:string}", 00H', { label: 'DB string', detail: 'Null-terminated string', type: 'type' }),
      snippetCompletion('DW ${1:1000H}, ${2:2000H}', { label: 'DW', detail: 'Define Word array', type: 'type' }),
      snippetCompletion('DS ${1:10H}', { label: 'DS', detail: 'Define Storage', type: 'type' })
    ])
  }
})

const asm8085HighlightStyle = HighlightStyle.define([
  { tag: hTags.keyword,             color: 'var(--syn-keyword)', fontWeight: '600' },
  { tag: hTags.atom,                color: 'var(--syn-register)' },
  { tag: hTags.number,              color: 'var(--syn-number)' },
  { tag: hTags.string,              color: 'var(--syn-string)' },
  { tag: hTags.comment,             color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: hTags.labelName,           color: 'var(--syn-label)' },
  { tag: hTags.className,           color: 'var(--syn-label-standalone, var(--syn-label))', fontWeight: 'bold' },
  { tag: hTags.meta,                color: 'var(--syn-directive)' },
  { tag: hTags.typeName,            color: 'var(--syn-data)', fontWeight: '600' },
  { tag: hTags.variableName,        color: 'var(--text)' },
  { tag: hTags.special(hTags.variableName), color: 'var(--syn-pseudo)', fontWeight: '600' },
])

export const asm8085Highlighting = syntaxHighlighting(asm8085HighlightStyle)

export const asm8085Linter = linter((view) => {
  const diagnostics = []
  const doc = view.state.doc
  
  let lastLabel = null
  let instsSinceLabel = 0

  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i)
    const textWithoutComment = line.text.split(';')[0]
    
    // Match: (1) leading spaces, (2) optional label:, (3) spaces, (4) instruction
    const match = textWithoutComment.match(/^(\s*)([A-Za-z0-9_]+:)?(\s*)([A-Za-z_][A-Za-z0-9_]*)?/)
    
    if (match) {
      if (match[2]) {
        lastLabel = match[2].replace(':', '').toUpperCase()
        instsSinceLabel = 0
      }
      
      if (match[4]) {
        const word = match[4].toUpperCase()
        const afterWord = textWithoutComment.substring(match[0].length).trim().toUpperCase()
      
      // Special case: Ignore symbols defined using EQU or SET (e.g., MAX EQU 0FFH)
      if (afterWord.startsWith('EQU') || afterWord.startsWith('SET')) continue
      
      const from = line.from + match[1].length + (match[2] ? match[2].length : 0) + match[3].length
      const to = from + match[4].length

      if (ASM8085_UNSUPPORTED.has(word)) {
        diagnostics.push({
          from, to,
          severity: 'warning',
          message: `'${word}' is valid assembly, but macros and conditionals are not supported by sim8085.`
        })
      } else if (!ASM8085_MNEMONICS.has(word) && !ASM8085_DIRECTIVES.has(word) && !ASM8085_DATA.has(word) && !ASM8085_PSEUDO.has(word)) {
        diagnostics.push({
          from, to,
          severity: 'error',
          message: `Unknown instruction or directive: '${match[4]}'`
        })
      } else if (afterWord === '' && !ASM8085_NO_OPERAND.has(word)) {
        diagnostics.push({
          from, to,
          severity: 'error',
          message: `Missing operand for '${word}'.`
        })
      } else if (ASM8085_REQUIRES_COMMA.has(word) && !afterWord.includes(',')) {
        diagnostics.push({
          from, to,
          severity: 'error',
          message: `Missing comma between operands for '${word}'.`
        })
      }
    }
  }
  
  return diagnostics
})
