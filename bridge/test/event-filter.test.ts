// Tests: event-filter.ts (filterEvent) + stripMentionPrefix
// Uses node:test — run with: node --test --import tsx/esm test/event-filter.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { filterEvent, stripMentionPrefix, isLarkEvent } from "../src/ingest/event-filter.js";

const BOT_NAME = "Chanh Quản Gia";

// Real captured fixture from lark-cli event consume
const FIXTURE_GROUP_TEXT = {
  type: "im.message.receive_v1",
  event_id: "216596a2e34be01e641d8a09621bf33d",
  timestamp: "1780857477320",
  id: "om_x100b6d6fe69c88a4e1576b6dfdea3c3",
  message_id: "om_x100b6d6fe69c88a4e1576b6dfdea3c3",
  create_time: "1780857477092",
  chat_id: "oc_2d1920f8015432088e8013a9a46a17fa",
  chat_type: "group",
  message_type: "text",
  sender_id: "ou_ac48dc3cecb9bb914f9cca6ee6cfff93",
  content: "@Chanh Quản Gia tính 2+2",
};

describe("stripMentionPrefix", () => {
  it("strips exact @BotName prefix", () => {
    assert.equal(stripMentionPrefix("@Chanh Quản Gia tính 2+2", BOT_NAME), "tính 2+2");
  });

  it("is case-insensitive", () => {
    assert.equal(stripMentionPrefix("@chanh quản gia hello", BOT_NAME), "hello");
  });

  it("returns empty string when mention-only", () => {
    assert.equal(stripMentionPrefix("@Chanh Quản Gia", BOT_NAME), "");
  });

  it("returns original text unchanged if no @prefix", () => {
    assert.equal(stripMentionPrefix("just some text", BOT_NAME), "just some text");
  });

  it("trims surrounding whitespace", () => {
    assert.equal(stripMentionPrefix("  @Chanh Quản Gia   hi  ", BOT_NAME), "hi");
  });
});

describe("isLarkEvent", () => {
  it("accepts valid fixture", () => {
    assert.ok(isLarkEvent(FIXTURE_GROUP_TEXT));
  });

  it("rejects null", () => {
    assert.equal(isLarkEvent(null), false);
  });

  it("rejects missing message_id", () => {
    const bad = { ...FIXTURE_GROUP_TEXT, message_id: undefined };
    assert.equal(isLarkEvent(bad), false);
  });
});

describe("filterEvent — group + text (accepted)", () => {
  it("accepts real fixture and strips mention", () => {
    const result = filterEvent(FIXTURE_GROUP_TEXT, BOT_NAME);
    assert.equal(result.accepted, true);
    assert.equal(result.text, "tính 2+2");
    assert.equal(result.event.chat_id, "oc_2d1920f8015432088e8013a9a46a17fa");
  });
});

describe("filterEvent — group text WITHOUT bot mention (dropped)", () => {
  // Real-world: groups can grant the bot "receive all messages", so group
  // delivery does NOT imply @bot. These must be dropped (else the bot spams).
  it("drops plain chatter (no @)", () => {
    const e = { ...FIXTURE_GROUP_TEXT, content: "ae đi nha, a bị kẹt bên q6" };
    assert.equal(filterEvent(e, BOT_NAME).accepted, false);
  });

  it("drops @all (@_all)", () => {
    const e = { ...FIXTURE_GROUP_TEXT, content: "@_all đi ăn mấy anh ơiiii" };
    assert.equal(filterEvent(e, BOT_NAME).accepted, false);
  });

  it("drops @other-person", () => {
    const e = { ...FIXTURE_GROUP_TEXT, content: "@Huỳnh Trung Hiếu đã add đủ hết rồi ạ" };
    assert.equal(filterEvent(e, BOT_NAME).accepted, false);
  });

  it("accepts when bot mentioned mid-sentence", () => {
    const e = { ...FIXTURE_GROUP_TEXT, content: "ê @Chanh Quản Gia giúp tao" };
    const r = filterEvent(e, BOT_NAME);
    assert.equal(r.accepted, true);
    assert.equal(r.text, "ê giúp tao");
  });
});

describe("filterEvent — p2p (dropped)", () => {
  it("drops p2p chat_type", () => {
    const p2p = { ...FIXTURE_GROUP_TEXT, chat_type: "p2p" };
    const result = filterEvent(p2p, BOT_NAME);
    assert.equal(result.accepted, false);
  });
});

describe("filterEvent — group non-text (dropped)", () => {
  it("drops image message_type in group", () => {
    const img = { ...FIXTURE_GROUP_TEXT, message_type: "image" };
    const result = filterEvent(img, BOT_NAME);
    assert.equal(result.accepted, false);
  });

  it("drops file message_type in group", () => {
    const file = { ...FIXTURE_GROUP_TEXT, message_type: "file" };
    const result = filterEvent(file, BOT_NAME);
    assert.equal(result.accepted, false);
  });
});

describe("filterEvent — non-event object (dropped)", () => {
  it("drops plain string", () => {
    const result = filterEvent("not an event", BOT_NAME);
    assert.equal(result.accepted, false);
  });

  it("drops empty object", () => {
    const result = filterEvent({}, BOT_NAME);
    assert.equal(result.accepted, false);
  });
});
