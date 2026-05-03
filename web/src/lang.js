import { StreamLanguage, HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as hTags } from '@lezer/highlight'

const ASM8085_MNEMONICS = new Set([
  'ACI','ADC','ADD','ADI','ANA','ANI','CALL','CC','CM','CMA','CMC','CMP','CNC','CNZ','CP','CPE','CPI','CPO','CZ',
  'DAA','DAD','DCR','DCX','DI','EI','HLT','IN','INR','INX','JC','JM','JMP','JNC','JNZ','JP','JPE','JPO','JZ',
  'LDA','LDAX','LHLD','LXI','MOV','MVI','NOP','ORA','ORI','OUT','PCHL','POP','PUSH','RAL','RAR','RC','RET','RLC',
  'RM','RNC','RNZ','RP','RPE','RPO','RRC','RST','RZ','SBB','SBI','SHLD','SPHL','STA','STAX','STC','SUB','SUI',
  'XCHG','XRA','XRI','XTHL',
])
const ASM8085_REGS      = new Set(['A','B','C','D','E','H','L','M','SP','PSW'])
const ASM8085_DIRECTIVES = new Set(['ORG','EQU','DB','DW','DS','END','IF','ENDIF','MACRO','ENDM','SET'])
const ASM8085_PSEUDO    = new Set(['KICKOFF','ASSERT','SETBYTE','SETWORD'])

export const asm8085Lang = StreamLanguage.define({
  token(stream) {
    if (stream.eatSpace()) return null
    if (stream.eat(';')) { stream.skipToEnd(); return 'comment' }
    if (stream.match(/^[A-Za-z0-9_]+:/))      return 'labelName'
    if (stream.match(/^[0-9A-Fa-f]+[Hh]\b/)) return 'number'
    if (stream.match(/^[01]+[Bb]\b/))         return 'number'
    if (stream.match(/^[0-9]+\b/))            return 'number'
    if (stream.match(/^'[^']*'/))             return 'string'
    if (stream.match(/^[A-Za-z_][A-Za-z0-9_]*/)) {
      const word = stream.current().toUpperCase()
      if (ASM8085_MNEMONICS.has(word))  return 'keyword'
      if (ASM8085_REGS.has(word))       return 'atom'
      if (ASM8085_DIRECTIVES.has(word)) return 'meta'
      if (ASM8085_PSEUDO.has(word))     return 'variable-2'
      return 'variableName'
    }
    stream.next()
    return null
  },
})

const asm8085HighlightStyle = HighlightStyle.define([
  { tag: hTags.keyword,             color: 'var(--syn-keyword)', fontWeight: '600' },
  { tag: hTags.atom,                color: 'var(--syn-register)' },
  { tag: hTags.number,              color: 'var(--syn-number)' },
  { tag: hTags.string,              color: 'var(--syn-string)' },
  { tag: hTags.comment,             color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: hTags.labelName,           color: 'var(--syn-label)' },
  { tag: hTags.meta,                color: 'var(--syn-directive)' },
  { tag: hTags.variableName,        color: 'var(--text)' },
  { tag: hTags.special(hTags.variableName), color: 'var(--syn-pseudo)', fontWeight: '600' },
])

export const asm8085Highlighting = syntaxHighlighting(asm8085HighlightStyle)
