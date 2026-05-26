import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const source = readFileSync(join(process.cwd(), "src/components/ui/alert-dialog.tsx"), "utf8")

assert.match(
  source,
  /import \{ AlertDialog as AlertDialogPrimitive \} from "@base-ui\/react\/alert-dialog"/,
  "alert dialog should use the original Base UI primitive wrapper"
)

assert.doesNotMatch(
  source,
  /createContext|createPortal|useContext/,
  "alert dialog should not replace the primitive implementation with a custom dialog system"
)

assert.match(
  source,
  /function AlertDialogClose\(\{\s*className,\s*type = "button",\s*\.\.\.props\s*\}: AlertDialogPrimitive\.Close\.Props\)/,
  "alert dialog close should default to a button-safe type"
)

assert.match(
  source,
  /return <AlertDialogPrimitive\.Close type=\{type\} className=\{className\} \{\.\.\.props\} \/>/,
  "alert dialog close should forward the safe button type to the Base UI close primitive"
)
