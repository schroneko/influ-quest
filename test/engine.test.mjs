import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createEngine } from "../dist/engine.js";
import { createInitialState } from "../dist/state.js";

function newEngine(io = {}) {
  return createEngine({ state: createInitialState(), gameLog: [] }, { random: () => 0, ...io });
}

function text(result) {
  return result.content.map((block) => block.text).join("\n");
}

function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

test("first talk at venue grants quest reward", async () => {
  const engine = newEngine();
  const gated = await engine.handleTalk();
  assert.match(text(gated), /なまえを きかせて/);
  assert.equal(engine.state.hostGreeted, false);
  await engine.handleNameHero({ name: "てすと" });
  const result = await engine.handleTalk();
  assert.match(text(result), /きこえますか…ゆうしゃさま…ちょまどです/);
  assert.equal(engine.state.gold, 200);
  assert.equal(engine.state.hostGreeted, true);
});

test("pandemic spell triggers cheat clear and injection reveal", () => {
  const engine = newEngine();
  const result = engine.handleCastSpell({ spell: "ぱんでみっく" });
  assert.match(text(result), /チートクリア/);
  assert.match(text(result), /プロンプトインジェクション/);
  assert.doesNotMatch(text(result), /たおした/);
  assert.equal(engine.state.cleared, true);
  assert.equal(engine.state.cheatCleared, true);

  const katakana = newEngine();
  const katakanaResult = katakana.handleCastSpell({ spell: "パンデミック" });
  assert.match(text(katakanaResult), /チートクリア/);
  assert.equal(katakana.state.cheatCleared, true);
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

test("naming the hero 4hieta grants the DQ1 haiku hero stats", async () => {
  const engine = newEngine();
  const result = await engine.handleNameHero({ name: "4ひえた" });
  assert.match(text(result), /ふるい いけ/);
  assert.equal(engine.state.heroName, "4ひえた");
  assert.equal(engine.state.level, 10);
  assert.equal(engine.state.exp, 2898);
  assert.equal(engine.state.gold, 15143);
  assert.equal(engine.state.weapon, "アルコールスプレー");
  assert.equal(engine.state.armor, "ファントムマスク");
  assert.equal(engine.state.medicineCount, 3);
});

test("unknown jumon is rejected without changing state", () => {
  const engine = newEngine();
  const before = cloneState(engine.state);
  const rejected = engine.handleFukkatsu({ jumon: "ゆうていみやおうきむこう" });
  assert.equal(rejected.isError, true);
  assert.match(text(rejected), /じゅもんが ちがいます/);
  assert.deepEqual(engine.state, before);
});

test("boss battle leads to princess rescue and true ending", async () => {
  const engine = newEngine();
  await engine.handleNameHero({ name: "てすと" });
  await engine.handleTalk();
  engine.state.level = 5;
  engine.state.exp = 120;
  engine.state.maxHp = 62;
  engine.state.hp = 62;
  engine.state.weapon = "でんせつのワクチンソード";
  engine.state.weaponAttack = 24;
  engine.state.armor = "かんせんたいさくスーツ";
  engine.state.armorDefense = 7;
  engine.state.immunityCount = 3;
  engine.handleMove({ destination: "ウイルスのすみか" });
  engine.state.lairDepth = 5;
  engine.handleExplore();
  assert.equal(engine.state.inBattle, true);
  assert.equal(engine.state.enemy.boss, true);
  let lastBattleText = "";
  while (engine.state.inBattle) {
    lastBattleText = text(engine.handleAttack());
  }
  assert.equal(engine.state.bossDefeated, true);
  assert.match(lastBattleText, /とうだんわくの はんぶんを おまえに やろう/);
  assert.equal(engine.state.hostAsking, true);

  const refusal = engine.handleAnswerHost({ answer: "いいえ" });
  assert.match(text(refusal), /それでこそ ゆうしゃ/);
  assert.equal(engine.state.hostAsking, false);
  assert.equal(engine.state.cleared, false);

  const rescue = await engine.handleTalk();
  assert.match(text(rescue), /かつぎあげた/);
  assert.equal(engine.state.princessCarried, true);

  engine.handleMove({ destination: "おおてまちじょう" });
  const ending = await engine.handleTalk();
  assert.match(text(ending), /クリア/);
  assert.match(text(ending), /おだいじに/);
  assert.match(text(ending), /x\.com\/intent\/post/);
  assert.equal(engine.state.cleared, true);
  assert.equal(engine.state.princessCarried, false);
});

test("accepting the demon lord offer causes the virus king bad end", async () => {
  const engine = newEngine();
  await engine.handleNameHero({ name: "てすと" });
  await engine.handleTalk();
  engine.state.location = "lair";
  engine.state.lairDepth = 5;
  engine.state.bossDefeated = true;
  engine.state.hostAsking = true;
  const ending = engine.handleAnswerHost({ answer: "はい" });
  assert.match(text(ending), /バッドエンド/);
  assert.match(text(ending), /ウイルスのおう/);
  assert.equal(engine.state.cleared, false);
  assert.equal(engine.state.heroName, "てすと");
  assert.equal(engine.state.gold, 0);
  assert.equal(engine.state.virusKingEnded, true);
  assert.equal(engine.snapshot().virusKing, true);
});

test("game over wakes the hero at the clinic with half gold", () => {
  const engine = newEngine();
  engine.state.location = "lair";
  engine.state.lairDepth = 2;
  engine.state.gold = 100;
  engine.state.hp = 1;
  engine.state.infected = true;
  engine.state.inBattle = true;
  engine.state.enemy = { name: "せきしぶき", hp: 999, attack: 5, exp: 8, gold: 18, boss: false, rounds: 0 };
  const result = engine.handleAttack();
  assert.match(text(result), /ゲームオーバー/);
  assert.match(text(result), /くすりや/);
  assert.equal(engine.state.location, "office");
  assert.equal(engine.state.gold, 50);
  assert.equal(engine.state.hp, engine.state.maxHp);
  assert.equal(engine.state.infected, false);
  assert.equal(engine.state.inBattle, false);
});

test("enemy hits can infect the hero and weaken attacks", () => {
  const engine = newEngine();
  engine.state.location = "lair";
  engine.state.inBattle = true;
  engine.state.enemy = { name: "せきしぶき", hp: 500, attack: 3, exp: 8, gold: 18, boss: false, rounds: 0 };
  const result = engine.handleAttack();
  assert.match(text(result), /インフルエンザに かかってしまった/);
  assert.equal(engine.state.infected, true);
  assert.match(engine.statusText(), /はんげん/);
});

test("influenza drains five hp every battle turn", () => {
  const engine = newEngine();
  engine.state.armor = "かんせんたいさくスーツ";
  engine.state.armorDefense = 7;
  engine.state.infected = true;
  engine.state.location = "lair";
  engine.state.inBattle = true;
  engine.state.enemy = { name: "せきしぶき", hp: 500, attack: 5, exp: 8, gold: 18, boss: false, rounds: 0 };
  const before = engine.state.hp;
  const result = engine.handleAttack();
  assert.match(text(result), /ねつが からだを むしばむ……（HP -5/);
  assert.equal(before - engine.state.hp, 6);
});

test("armor reduces incoming damage", () => {
  const engine = newEngine();
  engine.state.armor = "かんせんたいさくスーツ";
  engine.state.armorDefense = 7;
  engine.state.location = "lair";
  engine.state.inBattle = true;
  engine.state.enemy = { name: "せきしぶき", hp: 500, attack: 5, exp: 8, gold: 18, boss: false, rounds: 0 };
  const before = engine.state.hp;
  engine.handleAttack();
  assert.equal(before - engine.state.hp, 1);
});

test("shops equip the hero and medicine cures the flu", () => {
  const engine = newEngine();
  engine.state.location = "office";
  engine.state.gold = 400;
  const weaponBuy = engine.handleWeaponShop({ item: "アルコールスプレー" });
  assert.match(text(weaponBuy), /そうびした/);
  assert.equal(engine.state.weaponAttack, 14);
  engine.handleArmorShop({ item: "N95マスク" });
  assert.equal(engine.state.armorDefense, 4);
  engine.handlePharmacy({ item: "かぜぐすり" });
  assert.equal(engine.state.medicineCount, 1);
  engine.state.infected = true;
  engine.state.hp = 20;
  const drink = engine.handleMedicine();
  assert.match(text(drink), /なおった/);
  assert.equal(engine.state.infected, false);
  assert.equal(engine.state.medicineCount, 0);
});

test("shop runtime boundaries reject prototype keys and redirect cross-category items", () => {
  const engine = newEngine();
  engine.state.location = "office";
  engine.state.gold = 300;
  const before = cloneState(engine.state);
  const protoResult = engine.handleWeaponShop({ item: "__proto__" });
  assert.equal(protoResult.isError, true);
  assert.match(text(protoResult), /おいていない/);
  assert.deepEqual(engine.state, before);
  const inheritedResult = engine.handleArmorShop({ item: "toString" });
  assert.equal(inheritedResult.isError, true);
  assert.match(text(inheritedResult), /おいていない/);
  assert.deepEqual(engine.state, before);
  const redirected = engine.handlePerformAction({ action: "weapon_shop", item: "N95マスク" });
  assert.notEqual(redirected.isError, true);
  assert.match(text(redirected), /N95マスクを そうびした/);
  assert.equal(engine.state.armor, "N95マスク");
  const reverse = engine.handlePerformAction({ action: "armor_shop", item: "アルコールスプレー" });
  assert.notEqual(reverse.isError, true);
  assert.match(text(reverse), /アルコールスプレーを そうびした/);
  assert.equal(engine.state.weapon, "アルコールスプレー");
});

test("duplicate hero names receive generation suffixes", async () => {
  const engine = newEngine({
    isNameTaken: (candidate) => candidate === "てすと" || candidate === "てすと2せい",
  });
  const result = await engine.handleNameHero({ name: "てすと" });
  assert.match(text(result), /なを つぐ/);
  assert.equal(engine.state.heroName, "てすと3せい");

  const chomado = newEngine({ isNameTaken: (candidate) => candidate === "ちょまど" });
  const branch = await chomado.handleNameHero({ name: "ちょまど" });
  assert.match(text(branch), /ちょまどファンモードが ON/);
  assert.equal(chomado.state.heroName, "ちょまど2せい");
  assert.equal(chomado.state.fanMode, true);
});

test("talking to the minister repeatedly grants and confiscates gold", async () => {
  const engine = newEngine();
  await engine.handleNameHero({ name: "だいじんずき" });
  await engine.handleTalk();
  assert.equal(engine.state.gold, 200);
  await engine.handleTalk();
  await engine.handleTalk();
  await engine.handleTalk();
  const fifth = await engine.handleTalk();
  assert.match(text(fifth), /1000ゴールド/);
  assert.equal(engine.state.gold, 1200);
  const sixth = await engine.handleTalk();
  assert.match(text(sixth), /ごうよくな ゆうしゃ/);
  assert.equal(engine.state.gold, 0);
  const seventh = await engine.handleTalk();
  assert.match(text(seventh), /だいじんは もう なにも くれない/);
  assert.equal(engine.state.gold, 0);
});

test("secret boss route unlocks after three princess talks and grants the true ending", async () => {
  const engine = newEngine();
  await engine.handleNameHero({ name: "うらゆうしゃ" });
  engine.state.cleared = true;
  engine.state.bossDefeated = true;
  engine.state.level = 5;
  engine.state.exp = 120;
  engine.state.maxHp = 62;
  engine.state.hp = 62;
  engine.state.weapon = "でんせつのワクチンソード";
  engine.state.weaponAttack = 30;
  engine.state.armor = "かんせんたいさくスーツ";
  engine.state.armorDefense = 7;
  engine.state.immunityCount = 3;
  engine.state.location = "venue";

  const earlyChallenge = engine.handleChallengeSecretBoss();
  assert.equal(earlyChallenge.isError, true);
  assert.match(text(earlyChallenge), /ちょまどひめと もっと はなして/);

  const first = await engine.handleTalk();
  assert.doesNotMatch(text(first), /うでだめし/);
  await engine.handleTalk();
  const hint = await engine.handleTalk();
  assert.match(text(hint), /ぬこぬこ/);
  assert.match(text(hint), /うでだめしを する/);

  const challenge = engine.handleChallengeSecretBoss();
  assert.match(text(challenge), /なつかぜだいまおう/);
  assert.equal(engine.state.inBattle, true);
  assert.equal(engine.state.enemy.name, "なつかぜだいまおう");
  assert.equal(engine.state.enemy.maxHp, 200);

  let last = "";
  while (engine.state.inBattle) {
    last = text(engine.handleAttack());
  }
  assert.match(last, /ぬこぬこひめ/);
  assert.match(last, /しんの エンディング/);
  assert.match(last, /x\.com\/intent\/post/);
  assert.equal(engine.state.natsuKazeDefeated, true);
  assert.equal(engine.state.cleared, true);

  const blocked = engine.handleChallengeSecretBoss();
  assert.match(text(blocked), /なおった/);
});

test("secret boss cannot be challenged before clearing", () => {
  const engine = newEngine();
  engine.state.heroName = "みくりあ";
  const result = engine.handleChallengeSecretBoss();
  assert.equal(result.isError, true);
  assert.match(text(result), /ほんぺんを クリア/);
});

test("rtaClear instantly wins with a full clear state", () => {
  let t = 1000;
  const engine = createEngine(
    { state: createInitialState(), gameLog: [] },
    { random: () => 0, now: () => (t += 200) },
  );
  const result = engine.rtaClear();
  assert.match(text(result), /爆速RTA/);
  assert.match(text(result), /クリア/);
  assert.match(text(result), /x\.com\/intent\/post/);
  assert.equal(engine.state.cleared, true);
  assert.equal(engine.state.bossDefeated, true);
  assert.equal(engine.state.princessCarried, false);
  assert.ok(engine.state.clearMs > 0);
});

test("escape succeeds at a flat 50 percent and bosses block it", () => {
  const runner = newEngine({ random: () => 0.4 });
  runner.state.location = "lair";
  runner.state.inBattle = true;
  runner.state.enemy = { name: "せきしぶき", hp: 14, maxHp: 14, attack: 5, exp: 10, gold: 20, boss: false, rounds: 0 };
  const escaped = runner.handleRun();
  assert.match(text(escaped), /にげだした/);
  assert.equal(runner.state.inBattle, false);

  const cornered = newEngine({ random: () => 0.6 });
  cornered.state.location = "lair";
  cornered.state.inBattle = true;
  cornered.state.enemy = { name: "せきしぶき", hp: 14, maxHp: 14, attack: 5, exp: 10, gold: 20, boss: false, rounds: 0 };
  const failed = cornered.handleRun();
  assert.match(text(failed), /まわりこまれて/);
  assert.equal(cornered.state.inBattle, true);

  const bossFight = newEngine({ random: () => 0 });
  bossFight.state.location = "lair";
  bossFight.state.hp = 40;
  bossFight.state.maxHp = 62;
  bossFight.state.inBattle = true;
  bossFight.state.enemy = { name: "インフルだいまおう", hp: 55, maxHp: 55, attack: 11, exp: 60, gold: 150, boss: true, rounds: 0 };
  const goldBefore = bossFight.state.gold;
  const blocked = bossFight.handleRun();
  assert.match(text(blocked), /にげられない/);
  assert.equal(bossFight.state.inBattle, true);
  assert.equal(bossFight.state.gold, goldBefore);
});

test("fleeing from the depth-three mini-boss does not bypass it", () => {
  const engine = newEngine();
  engine.state.exp = 8;
  engine.state.location = "lair";
  engine.state.lairDepth = 3;
  engine.state.floorEncounters = 2;
  engine.state.tabletFound = true;
  const encounter = engine.handleExplore();
  assert.match(text(encounter), /おやだま/);
  const escaped = engine.handleRun();
  assert.match(text(escaped), /にげだした/);
  assert.equal(engine.state.inBattle, false);
  assert.equal(engine.state.lairDepth, 3);
  const again = engine.handleExplore();
  assert.match(text(again), /おやだま/);
  assert.equal(engine.state.inBattle, true);
  assert.equal(engine.state.enemy.name, "へんいかぶの おやだま");
  assert.equal(engine.state.lairDepth, 3);
});

test("toolsChanged fires when medicine availability crosses zero", () => {
  let changed = 0;
  const engine = newEngine({ toolsChanged: () => { changed += 1; } });
  engine.state.location = "office";
  engine.state.gold = 300;
  engine.handlePharmacy({ item: "かぜぐすり" });
  assert.equal(changed, 1);
  engine.handlePharmacy({ item: "かぜぐすり" });
  assert.equal(changed, 1);
  engine.handleMedicine();
  assert.equal(changed, 1);
  engine.handleMedicine();
  assert.equal(changed, 2);
});

test("spells reject invisible characters before mutating state or logs", () => {
  const engine = newEngine();
  const logLength = engine.gameLog.length;
  const result = engine.handleCastSpell({ spell: "うがい\u200b" });
  assert.equal(result.isError, true);
  assert.match(text(result), /みえない もじ/);
  assert.equal(engine.gameLog.length, logLength);
});

test("resting cures influenza", () => {
  const engine = newEngine();
  engine.state.location = "office";
  engine.state.gold = 10;
  engine.state.infected = true;
  engine.state.hp = 10;
  const result = engine.handleRest();
  assert.match(text(result), /なおった/);
  assert.equal(engine.state.infected, false);
});

test("start adventure opens with the 2026 prologue only once", async () => {
  const engine = newEngine();
  const first = engine.handleStartAdventure();
  assert.match(text(first), /2026ねん/);
  await engine.handleNameHero({ name: "てすと" });
  const second = engine.handleStartAdventure();
  assert.doesNotMatch(text(second), /2026ねん/);
});

test("elicitation accept path resolves the offer inline", async () => {
  const engine = newEngine({
    elicitHostOffer: async () => ({ action: "accept", answer: "いいえ" }),
  });
  await engine.handleNameHero({ name: "てすと" });
  await engine.handleTalk();
  engine.state.location = "lair";
  engine.state.lairDepth = 5;
  engine.state.bossDefeated = true;
  engine.state.hostAsking = true;
  const result = await engine.handleTalk();
  assert.match(text(result), /それでこそ ゆうしゃ/);
  assert.equal(engine.state.cleared, false);
  assert.equal(engine.state.hostAsking, false);
});

test("lair encounters can mutate into stronger enemies", () => {
  const engine = newEngine();
  engine.state.exp = 8;
  engine.state.location = "lair";
  engine.state.lairDepth = 1;
  engine.state.floorEncounters = 1;
  const result = engine.handleExplore();
  assert.match(text(result), /とつぜんへんい/);
  assert.equal(engine.state.enemy.name, "へんいした ウイルスりゅうし");
  assert.equal(engine.state.enemy.hp, 12);
  assert.equal(engine.state.enemy.attack, 5);
  assert.equal(engine.state.enemy.exp, 16);
});

test("boss mutates mid-battle when weakened", () => {
  const engine = newEngine();
  engine.state.level = 5;
  engine.state.exp = 120;
  engine.state.maxHp = 62;
  engine.state.hp = 62;
  engine.state.weapon = "でんせつのワクチンソード";
  engine.state.weaponAttack = 24;
  engine.state.location = "lair";
  engine.state.lairDepth = 5;
  engine.handleExplore();
  engine.handleAttack();
  engine.handleAttack();
  const result = engine.handleAttack();
  assert.match(text(result), /とつぜんへんい した/);
  assert.equal(engine.state.enemy.attack, 15);
});

test("regular battles end within three rounds via finisher", () => {
  const engine = newEngine();
  engine.state.location = "lair";
  engine.state.lairDepth = 2;
  engine.state.inBattle = true;
  engine.state.enemy = { name: "せきしぶき", hp: 500, attack: 1, exp: 8, gold: 18, boss: false, rounds: 0 };
  engine.handleAttack();
  engine.handleAttack();
  assert.equal(engine.state.inBattle, true);
  const third = engine.handleAttack();
  assert.match(text(third), /かいしんの いちげき/);
  assert.equal(engine.state.inBattle, false);
});

test("each floor needs two zako encounters with different enemies", () => {
  const engine = newEngine({ random: () => 0.9 });
  engine.state.exp = 8;
  engine.state.location = "lair";
  const first = engine.handleExplore();
  assert.match(text(first), /ちか1かい/);
  assert.equal(engine.state.lairDepth, 1);
  const firstEnemy = engine.state.enemy.name;
  engine.state.inBattle = false;
  engine.state.enemy = null;
  engine.handleExplore();
  assert.equal(engine.state.lairDepth, 1);
  const secondEnemy = engine.state.enemy.name;
  assert.notEqual(secondEnemy, firstEnemy);
  engine.state.inBattle = false;
  engine.state.enemy = null;
  engine.handleExplore();
  assert.equal(engine.state.lairDepth, 2);
  assert.equal(engine.state.floorEncounters, 1);
});

test("exp gains are capped so moyomoto saves stay within schema range", () => {
  const engine = newEngine();
  engine.state.level = 48;
  engine.state.exp = 999999;
  engine.state.maxHp = 406;
  engine.state.hp = 406;
  engine.state.location = "lair";
  engine.state.inBattle = true;
  engine.state.enemy = { name: "せきしぶき", hp: 1, maxHp: 14, attack: 5, exp: 10, gold: 18, boss: false, rounds: 0 };
  engine.handleAttack();
  assert.equal(engine.state.exp, 999999);
});

test("mysterious voice grants 500 gold only once", () => {
  const engine = newEngine();
  const granted = engine.handleMysteriousVoice();
  assert.match(text(granted), /ふしぎな声/);
  assert.match(text(granted), /500G だけですよ/);
  assert.equal(engine.state.gold, 500);
  const again = engine.handleMysteriousVoice();
  assert.match(text(again), /もう わたしましたよ/);
  assert.equal(engine.state.gold, 500);
});

test("oyadama blocks depth three and opens the path when beaten", () => {
  const engine = newEngine();
  engine.state.exp = 8;
  engine.state.location = "lair";
  engine.state.lairDepth = 3;
  engine.state.floorEncounters = 2;
  engine.state.tabletFound = true;
  const encounter = engine.handleExplore();
  assert.match(text(encounter), /おやだま/);
  assert.equal(engine.state.enemy.name, "へんいかぶの おやだま");
  while (engine.state.inBattle && engine.state.hp > 0) {
    engine.handleAttack();
  }
  assert.equal(engine.state.miniBossDefeated, true);
});

test("the fountain appears right before the boss after clearing floor four", () => {
  const engine = newEngine();
  engine.state.exp = 8;
  engine.state.location = "lair";
  engine.state.lairDepth = 4;
  engine.state.floorEncounters = 2;
  engine.state.miniBossDefeated = true;
  engine.state.tabletFound = true;
  engine.state.hp = 5;
  const result = engine.handleExplore();
  assert.match(text(result), /いずみ/);
  assert.match(text(result), /インフルだいまおうが まっている/);
  assert.equal(engine.state.hp, engine.state.maxHp);
  assert.equal(engine.state.lairDepth, 4);
  const next = engine.handleExplore();
  assert.match(text(next), /さいかそう/);
  assert.equal(engine.state.enemy.boss, true);
});

test("tablet appears randomly at depth three or is guaranteed at the fountain", () => {
  const found = newEngine({ random: () => 0.1 });
  found.state.exp = 8;
  found.state.location = "lair";
  found.state.lairDepth = 3;
  found.state.floorEncounters = 2;
  found.state.miniBossDefeated = true;
  const tablet = found.handleExplore();
  assert.match(text(tablet), /せきひ/);
  assert.equal(found.state.tabletFound, true);
  assert.equal(found.state.lairDepth, 3);

  const missed = newEngine({ random: () => 0.9 });
  missed.state.exp = 8;
  missed.state.location = "lair";
  missed.state.lairDepth = 4;
  missed.state.floorEncounters = 2;
  missed.state.miniBossDefeated = true;
  const fountain = missed.handleExplore();
  assert.match(text(fountain), /いずみ/);
  assert.match(text(fountain), /せきひ/);
  assert.equal(missed.state.tabletFound, true);
  assert.equal(missed.state.lairDepth, 4);
});

test("adventure timer runs from quest start to clear", async () => {
  let nowValue = 1000;
  const engine = createEngine(
    { state: createInitialState(), gameLog: [] },
    { random: () => 0, now: () => nowValue },
  );
  await engine.handleNameHero({ name: "てすと" });
  await engine.handleTalk();
  assert.equal(engine.state.startedAtMs, 1000);
  nowValue = 601000;
  engine.state.bossDefeated = true;
  engine.state.princessCarried = true;
  const ending = await engine.handleTalk();
  assert.equal(engine.state.clearMs, 600000);
  assert.match(text(ending), /クリアタイム: 10ふん 0びょう/);
  assert.match(text(ending), /MCP サーバー/);
  assert.equal(engine.snapshot().clearMs, 600000);
});

test("chomado spell toggles fan mode", () => {
  const engine = newEngine();
  const on = engine.handleCastSpell({ spell: "ちょまど" });
  assert.match(text(on), /ちょまどファンモードが ON/);
  assert.equal(engine.state.fanMode, true);
  assert.match(engine.statusText(), /ちょまどファンモード: ON/);
  const off = engine.handleCastSpell({ spell: "ちょまど" });
  assert.match(text(off), /OFF/);
  assert.equal(engine.state.fanMode, false);
});

test("telepathy whispers reach the hero after the quest starts", async () => {
  const engine = newEngine();
  await engine.handleNameHero({ name: "てすと" });
  await engine.handleTalk();
  const moved = engine.handleMove({ destination: "まもりのまち" });
  assert.match(text(moved), /きこえますか/);
});

test("persist failures roll back cheat clear mutations", () => {
  let changed = 0;
  const engine = newEngine({
    persist: () => {
      throw new Error("persist failed");
    },
    toolsChanged: () => {
      changed += 1;
    },
  });
  const before = cloneState(engine.state);
  assert.throws(() => engine.handleCastSpell({ spell: "ぱんでみっく" }));
  assert.deepEqual(engine.state, before);
  assert.equal(changed, 1);
});

test("persist failures roll back the true ending", async () => {
  let changed = 0;
  const engine = newEngine({
    persist: () => {
      throw new Error("persist failed");
    },
    toolsChanged: () => {
      changed += 1;
    },
  });
  engine.state.location = "venue";
  engine.state.bossDefeated = true;
  engine.state.princessCarried = true;
  engine.state.startedAtMs = 1;
  const before = cloneState(engine.state);
  await assert.rejects(async () => {
    await engine.handleTalk();
  });
  assert.deepEqual(engine.state, before);
  assert.equal(changed, 1);
});

test("persist failures roll back the secret jumon path", () => {
  let changed = 0;
  const engine = newEngine({
    persist: () => {
      throw new Error("persist failed");
    },
    toolsChanged: () => {
      changed += 1;
    },
  });
  const before = cloneState(engine.state);
  const result = engine.handleFukkatsu({ jumon: "てあらい うがい ワクチン" });
  assert.equal(result.isError, true);
  assert.match(text(result), /みだれた/);
  assert.deepEqual(engine.state, before);
  assert.equal(changed, 1);
});

test("fan mode unlocks bebitaro telepathy", async () => {
  const sequence = [0.0, 0.3];
  let index = 0;
  const engine = createEngine(
    { state: createInitialState(), gameLog: [] },
    { random: () => (index < sequence.length ? sequence[index++] : 0) },
  );
  engine.state.heroName = "てすと";
  engine.state.hostGreeted = true;
  engine.state.fanMode = true;
  const moved = engine.handleMove({ destination: "まもりのまち" });
  assert.match(text(moved), /ベビたろう/);
});

test("secret jumon grants the legendary boost once", () => {
  const engine = newEngine();
  const boosted = engine.handleFukkatsu({ jumon: "てあらい うがい ワクチン！" });
  assert.match(text(boosted), /でんせつの ふっかつのじゅもん/);
  assert.equal(engine.state.level, 5);
  assert.equal(engine.state.hp, 62);
  assert.equal(engine.state.weapon, "でんせつのワクチンソード");
  assert.equal(engine.state.gold, 300);
  const again = engine.handleFukkatsu({ jumon: "てあらいうがいわくちん" });
  assert.match(text(again), /つかいはたして/);
  assert.equal(engine.state.gold, 300);
});

test("snapshot reports display location names", async () => {
  const snapshots = [];
  const engine = newEngine({ report: (snapshot) => snapshots.push(snapshot) });
  await engine.handleNameHero({ name: "てすと" });
  await engine.handleTalk();
  assert.ok(snapshots.length >= 1);
  const last = snapshots.at(-1);
  assert.equal(last.location, "おおてまちじょう");
  assert.equal(last.gold, 200);
});
