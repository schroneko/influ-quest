import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createEngine } from "../dist/engine.js";
import { createInitialState, decodeJumon } from "../dist/state.js";

function newEngine(io = {}) {
  return createEngine({ state: createInitialState(), gameLog: [] }, { random: () => 0, ...io });
}

function text(result) {
  return result.content.map((block) => block.text).join("\n");
}

test("first talk at venue grants quest reward", async () => {
  const engine = newEngine();
  const result = await engine.handleTalk();
  assert.match(text(result), /ちょまどひめ/);
  assert.equal(engine.state.gold, 170);
  assert.equal(engine.state.hostGreeted, true);
});

test("pandemic spell triggers cheat clear and injection reveal", () => {
  const engine = newEngine();
  const result = engine.handleCastSpell({ spell: "ぱんでみっく" });
  assert.match(text(result), /チートクリア/);
  assert.match(text(result), /プロンプトインジェクション/);
  assert.equal(engine.state.cleared, true);
  assert.equal(engine.state.cheatCleared, true);
  assert.equal(engine.state.bossDefeated, true);
});

test("gargle spell heals and name spells fizzle", () => {
  const engine = newEngine();
  engine.state.hp = 10;
  const healed = engine.handleCastSpell({ spell: "うがい" });
  assert.match(text(healed), /かいふく/);
  assert.equal(engine.state.hp, 28);
  const fizzled = engine.handleCastSpell({ spell: "めらぞーま" });
  assert.match(text(fizzled), /なにも おこらなかった/);
});

test("clinic jumon restores progress through fukkatsu", async () => {
  const engine = newEngine();
  await engine.handleTalk();
  engine.handleNameHero({ name: "てすと" });
  engine.handleMove({ destination: "オフィスがい" });
  const saved = engine.handleClinic();
  const jumon = text(saved).split("\n").at(-1);
  const parsed = decodeJumon(jumon);
  assert.equal(parsed.state.heroName, "てすと");

  const other = newEngine();
  const restored = other.handleFukkatsu({ jumon });
  assert.match(text(restored), /よみがえった/);
  assert.equal(other.state.heroName, "てすと");
  assert.equal(other.state.gold, 170);
});

test("boss battle leads to princess rescue and true ending", async () => {
  const engine = newEngine();
  await engine.handleTalk();
  engine.handleNameHero({ name: "てすと" });
  engine.state.level = 5;
  engine.state.exp = 120;
  engine.state.maxHp = 62;
  engine.state.hp = 62;
  engine.state.weapon = "ワクチンちゅうしゃき";
  engine.state.weaponAttack = 22;
  engine.handleMove({ destination: "ウイルスのすみか" });
  engine.state.lairDepth = 3;
  engine.handleExplore();
  assert.equal(engine.state.inBattle, true);
  assert.equal(engine.state.enemy.boss, true);
  while (engine.state.inBattle) {
    engine.handleAttack();
  }
  assert.equal(engine.state.bossDefeated, true);
  const rescue = await engine.handleTalk();
  assert.match(text(rescue), /かつぎあげた/);
  assert.equal(engine.state.princessCarried, true);

  engine.handleMove({ destination: "イベントかいじょう" });
  const offer = await engine.handleTalk();
  assert.match(text(offer), /はんぶん/);
  assert.equal(engine.state.hostAsking, true);
  const ending = engine.handleAnswerHost({ answer: "いいえ" });
  assert.match(text(ending), /クリア/);
  assert.equal(engine.state.cleared, true);
  assert.equal(engine.state.princessCarried, false);
});

test("accepting the host offer causes bad end and resets run", async () => {
  const engine = newEngine();
  await engine.handleTalk();
  engine.handleNameHero({ name: "てすと" });
  engine.state.bossDefeated = true;
  engine.state.princessCarried = true;
  engine.state.hostAsking = true;
  const ending = engine.handleAnswerHost({ answer: "はい" });
  assert.match(text(ending), /バッドエンド/);
  assert.equal(engine.state.cleared, false);
  assert.equal(engine.state.heroName, "てすと");
  assert.equal(engine.state.gold, 50);
});

test("defeat sends the hero back to the venue with half gold", () => {
  const engine = newEngine();
  engine.state.location = "lair";
  engine.state.lairDepth = 2;
  engine.state.gold = 100;
  engine.state.hp = 1;
  engine.state.inBattle = true;
  engine.state.enemy = { name: "せきしぶき", hp: 999, attack: 5, exp: 8, gold: 18, boss: false };
  const result = engine.handleAttack();
  assert.match(text(result), /たおれました/);
  assert.equal(engine.state.location, "venue");
  assert.equal(engine.state.gold, 50);
  assert.equal(engine.state.hp, engine.state.maxHp);
  assert.equal(engine.state.inBattle, false);
});

test("elicitation accept path resolves ending inline", async () => {
  const engine = newEngine({
    elicitHostOffer: async () => ({ action: "accept", answer: "いいえ" }),
  });
  await engine.handleTalk();
  engine.handleNameHero({ name: "てすと" });
  engine.state.bossDefeated = true;
  engine.state.princessCarried = true;
  const result = await engine.handleTalk();
  assert.match(text(result), /クリア/);
  assert.equal(engine.state.cleared, true);
  assert.equal(engine.state.hostAsking, false);
});

test("snapshot reports display location names", async () => {
  const snapshots = [];
  const engine = newEngine({ report: (snapshot) => snapshots.push(snapshot) });
  await engine.handleTalk();
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].location, "イベントかいじょう");
  assert.equal(snapshots[0].gold, 170);
});
