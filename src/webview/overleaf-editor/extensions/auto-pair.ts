import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { Prec } from '@codemirror/state'
import { keymap } from '@codemirror/view'

/** Inserts matching delimiters and removes an untouched pair with Backspace. */
export const autoPair = [
  closeBrackets(),
  Prec.highest(keymap.of(closeBracketsKeymap)),
]
