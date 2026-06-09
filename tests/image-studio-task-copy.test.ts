import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { studioMessages, type Locale } from "../src/lib/i18n"

const source = readFileSync(join(process.cwd(), "src/components/image-studio.tsx"), "utf8")
const selectedCanvasHeader = source.match(/<div className="relative flex items-center justify-between[\s\S]*?<div className="relative flex-1 overflow-y-auto/)?.[0] ?? ""
const selectedTaskSummary = source.match(/\{selectedTask && \([\s\S]*?\n\s*\)\}\s*<\/main>/)?.[0] ?? ""
const locales = Object.keys(studioMessages) as Locale[]
const inlineTaskCopyKeys = [
  "taskPartialInline",
  "taskFailedInline",
  "taskStoppedInline",
  "taskTimedOutInline",
] as const
type InlineTaskCopyKey = (typeof inlineTaskCopyKeys)[number]
const localizedInlineCopy = {
  ko: {
    taskPartialInline: "{count}/{total}개를 생성했습니다. 부분 결과를 보관했습니다: {error}",
    taskFailedInline: "이 작업은 실패했습니다: {error}",
    taskStoppedInline: "이 작업은 중지되었습니다. 이미지 {count}개를 보관했습니다.",
    taskTimedOutInline: "이 작업은 시간 초과되었습니다. 이미지 {count}개를 보관했습니다.",
  },
  es: {
    taskPartialInline: "Se generaron {count}/{total}. Resultado parcial conservado: {error}",
    taskFailedInline: "Esta tarea falló: {error}",
    taskStoppedInline: "Esta tarea se detuvo. Se conservaron {count} imagen{suffix}.",
    taskTimedOutInline: "Esta tarea agotó el tiempo de espera. Se conservaron {count} imagen{suffix}.",
  },
  fr: {
    taskPartialInline: "{count}/{total} image(s) générée(s). Résultat partiel conservé : {error}",
    taskFailedInline: "Cette tâche a échoué : {error}",
    taskStoppedInline: "Cette tâche a été arrêtée. {count} image{suffix} conservée(s).",
    taskTimedOutInline: "Cette tâche a expiré. {count} image{suffix} conservée(s).",
  },
  de: {
    taskPartialInline: "{count}/{total} generiert. Teilergebnis behalten: {error}",
    taskFailedInline: "Diese Aufgabe ist fehlgeschlagen: {error}",
    taskStoppedInline: "Diese Aufgabe wurde gestoppt. {count} Bild{suffix} behalten.",
    taskTimedOutInline: "Diese Aufgabe ist abgelaufen. {count} Bild{suffix} behalten.",
  },
  pt: {
    taskPartialInline: "{count}/{total} geradas. Resultado parcial mantido: {error}",
    taskFailedInline: "Esta tarefa falhou: {error}",
    taskStoppedInline: "Esta tarefa foi interrompida. {count} imagem{suffix} mantida(s).",
    taskTimedOutInline: "Esta tarefa atingiu o tempo limite. {count} imagem{suffix} mantida(s).",
  },
} satisfies Partial<Record<Locale, Record<InlineTaskCopyKey, string>>>
const requiredKeys = [
  "maxConcurrentTasks",
  "maxConcurrentTasksDescription",
  "taskQueueTitle",
  "taskQueueEmpty",
  "taskQueuePosition",
  "taskStatusQueued",
  "taskStatusRunning",
  "taskStatusCompleted",
  "taskStatusPartial",
  "taskStatusFailed",
  "taskStatusStopped",
  "taskStatusTimedOut",
  "taskRefsLabel",
  "removeQueuedTask",
  "taskPartialInline",
  "taskFailedInline",
  "taskStoppedInline",
  "taskTimedOutInline",
] as const

for (const locale of locales) {
  for (const key of requiredKeys) {
    assert.equal(typeof studioMessages[locale][key], "string", `${locale}.${key} should exist`)
    assert.ok(studioMessages[locale][key].trim(), `${locale}.${key} should not be blank`)
  }
}

for (const [locale, messages] of Object.entries(localizedInlineCopy) as Array<[Locale, Record<InlineTaskCopyKey, string>]>) {
  for (const key of inlineTaskCopyKeys) {
    assert.equal(studioMessages[locale][key], messages[key], `${locale}.${key} should be localized inline task copy`)
    assert.notEqual(studioMessages[locale][key], studioMessages.en[key], `${locale}.${key} should not inherit English inline task copy`)
  }
}

assert.match(source, /id="max-concurrent-tasks"/, "UI should expose a max concurrent tasks control")
assert.match(source, /setMaxConcurrentTasks\(clampMaxConcurrentTasks\(Number\(value\)\)\)/, "concurrency control should clamp values through the helper")
assert.match(source, /function TaskQueueList\(/, "task queue/list should be a named component in the result area")
assert.match(source, /taskQueuePosition/, "queued result state should use localized queue position copy")
assert.match(source, /status === "running"[\s\S]*text\.stopGeneration/, "running task rows should expose stop copy")
assert.match(source, /status === "queued"[\s\S]*text\.removeQueuedTask/, "queued task rows should expose remove copy")
assert.doesNotMatch(source, /Queue #/, "queued result state should not hardcode English queue copy")
const taskQueueSource = source.match(/function TaskQueueList\([\s\S]*?\n}\n\nfunction/)?.[0] || ""
assert.ok(taskQueueSource, "TaskQueueList source should be present")
assert.match(taskQueueSource, /aria-pressed=\{isSelected\}/, "task row buttons should expose selected state to assistive tech")
assert.doesNotMatch(taskQueueSource, /aria-label=\{`\$\{text\.taskQueueTitle\} \$\{index \+ 1\}`\}/, "task row buttons should not replace prompt copy with a generic queue label")
assert.doesNotMatch(taskQueueSource, /<span aria-hidden="true" className="line-clamp-1 text-sm font-medium text-foreground">\{task\.snapshot\.prompt\}<\/span>/, "task row prompt should remain exposed to assistive tech")
assert.match(taskQueueSource, /referenceNames\.length/, "task queue should preserve original reference count metadata")
assert.doesNotMatch(taskQueueSource, /references\.length/, "task queue should not depend on sanitized reference files for reference counts")
assert.doesNotMatch(taskQueueSource, /\brefs\b/, "task queue should not hardcode English refs copy")
assert.doesNotMatch(taskQueueSource, /snapshot\.apiKey/, "task UI should not render raw snapshot API keys")
assert.match(selectedCanvasHeader, /sanitizeEndpointForDisplay\(selectedTask\.endpoint \|\| selectedTask\.snapshot\.endpoint\)/, "selected task header should strip endpoint credentials before display")
assert.match(selectedTaskSummary, /\[text\.summaryEndpoint, sanitizeEndpointForDisplay\(selectedTask\.endpoint \|\| selectedTask\.snapshot\.endpoint\)\]/, "selected task summary should strip endpoint credentials before display")
assert.doesNotMatch(selectedCanvasHeader, /\{selectedTask\.endpoint \|\| selectedTask\.snapshot\.endpoint\}/, "selected task header should not render raw endpoint metadata")
