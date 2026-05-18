import assert from "node:assert/strict"

import { readResponseJson } from "../src/lib/http-response.ts"

async function main() {
  const jsonResponse = new Response(JSON.stringify({ ok: true }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    status: 200,
  })

  assert.deepEqual(await readResponseJson<{ ok: boolean }>(jsonResponse), { ok: true })

  const htmlResponse = new Response("<!DOCTYPE html><html><body>error</body></html>", {
    headers: {
      "content-type": "text/html; charset=utf-8",
    },
    status: 500,
  })

  assert.equal(await readResponseJson(htmlResponse), null)
}

void main()
