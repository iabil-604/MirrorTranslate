import { unifySpeakerNames } from './core.js?v=0.29.3';

// ---------------------------------------------------------------------------------------------
// Who is speaking, read off the text itself.
//
// A speaker is a person, never a voice: this module names people and knows nothing about voice ids,
// providers or moods. The voice a name reads in is looked up when the audio is made, from whatever
// the voice table says at that moment.
//
// The evidence a novel leaves lies around each quoted run: the name and the speech verb just before
// or just after it, the name of whoever acts in the same sentence, the name called out inside the
// quote (who is *not* speaking), and the rhythm of two people taking turns. Each piece of evidence
// gives a candidate points; the best candidate wins when it is clearly ahead, and a quote with no
// clear winner is left to whoever comes next in line — the translation's own label, the model, or
// nobody, in which case the default dialogue voice reads it.
// ---------------------------------------------------------------------------------------------

export const SPEAKER_SOURCE_LABELS = Object.freeze({
  manual: '手动指定',
  local: '本地识别',
  hint: '翻译时的标注',
  model: '副模型',
});

// Verbs of speech in the three scripts the floors come in. Chinese 道 is a verb only when it is not
// the tail of 知道, 味道 and their kind.
const ZH_SPEECH_RE = /(?:说|讲|问|喊|叫|吼|嚷|骂|念|唱|嘀咕|嘟囔|囔囔|嘟哝|咕哝|低语|开口|接话|插嘴|反问|追问|解释|补充|吐槽|抱怨|感叹|叹|呢喃|喃喃|自语|催促|求饶|哀求|命令|宣布|提醒|打断|重复|附和|反驳|承认|否认|招呼|回答|回应|应道|回道|答道|写道|笑道|哭道|哼道|嗯了一声|哼了一声|应了一声|(?<![知味街轨管通频渠力赛跑])道)/u;
const EN_SPEECH_RE = /\b(?:said|says|say|asked|asks|ask|replied|replies|reply|answered|answers|shouted|shouts|whispered|whispers|muttered|mutters|murmured|murmurs|called|calls|cried|cries|laughed|laughs|sighed|sighs|added|adds|continued|continues|exclaimed|snapped|hissed|growled|yelled|screamed|mumbled|stammered|breathed|chuckled|giggled|grumbled|announced|declared|repeated|protested|insisted|demanded|offered|admitted|noted|remarked|observed|wondered|pleaded|begged|urged|warned|teased|joked|scoffed|retorted|told|tells|greeted|spoke|speaks|went on|blurted|drawled|groaned|moaned|sneered|snorted|purred|barked|croaked|rasped|whined|wailed|sobbed|prompted|pressed|ventured|echoed|agreed|countered|corrected|interrupted|cut in|chimed in|piped up|trailed off)\b/i;
const JA_SPEECH_RE = /(?:言っ|言う|言い|云っ|尋ね|訊い|訊く|聞い|聞く|答え|返し|返す|返事|叫ん|叫ぶ|呟い|つぶやい|囁い|ささやい|囁く|笑っ|怒鳴っ|続け|呼びかけ|呼ん|口を開|漏らし|零し|こぼし|声を|唸っ|うなっ|告げ|語っ|問い|問う|吐き捨て|付け加え|念を押し|促し)/u;

// What stands right before a name when the name is the one spoken *to*, not the one speaking.
const ZH_ADDRESSEE_RE = /(?:对|向|朝|冲|跟|和|与|望着|看着|看向|盯着|瞪着|瞪了|瞪向|瞥了|瞥向|扫了|扫向|望向|问|回答|拉着|拽着|拉住|拉过|推了|拍了拍|拍着|递给|递到|叫住|喊住|凑近|转向|面向|冲着|朝着|对着|搂着|抱着|抱住|牵着|捏着|敲了敲|指着|指了指|替|给|帮)\s*$/u;
const EN_ADDRESSEE_RE = /\b(?:to|at|toward|towards|told|asked|answered|with|beside|facing|for)\s+$/i;
const JA_ADDRESSEE_RE = /^(?:に|へ|を|には|にも|へと)/u;
const JA_SUBJECT_RE = /^(?:は|が|も)/u;

// The name of the person called out inside a quote, at its head or after a comma at its tail.
const HEAD_CALL_RE = /^[\s「『“"'‘]*(.+?)[\s，、！!？?…—～~。,.:：]/u;
const TAIL_CALL_RE = /[，、,]\s*([^，、,]+?)[\s！!？?。.…～~」』”"'’]*$/u;

// A narration run that opens on a pronoun: whoever it names is in the scene, and when only one
// person is, the pronoun can only be that person.
const ZH_PRONOUN_LEAD_RE = /^\s*(?:他们|她们|他|她|它|彼女|彼)/u;
const EN_PRONOUN_LEAD_RE = /^\s*(?:he|she|they)\b/i;

const SCORE = Object.freeze({
  attributed: 100,
  pronoun: 45,
  script: 100,
  action: 55,
  // The reader's own name beside a quote, with no verb of speech: in a floor the character wrote,
  // the reader is mostly the one spoken to, so an action alone does not make them the speaker.
  userAction: 25,
  bystander: 20,
  sameLine: 70,
  sameLineNarrated: 45,
  alternation: 55,
  carryOn: 30,
  calledOut: -60,
  addressee: -40,
  answering: 30,
  // A quote that calls the reader by name is the character talking to them.
  toUser: 45,
  toCharacter: 25,
  subject: 15,
  paragraphBefore: 80,
  paragraphAction: 35,
  // One person carries the whole floor's dialogue: a quote nobody else claims is theirs.
  sole: 50,
});
const CONFIDENT = 50;
const MARGIN = 20;
// From here up the text has said outright who speaks, and the translation's label no longer outranks it.
const EXPLICIT = 80;
// How far back a name still counts as present in the scene, in utterances.
const PRESENT_WINDOW = 16;

function speechVerbIn(text) {
  return ZH_SPEECH_RE.test(text) || EN_SPEECH_RE.test(text) || JA_SPEECH_RE.test(text);
}

function shortSnippet(text, limit = 18) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > limit ? `${clean.slice(0, limit)}…` : clean;
}

/**
 * The cast as a lookup: every spelling of a name to the name the voice table knows the person by.
 * One-character spellings are left out; they match inside too many ordinary words.
 */
function buildLookup(cast) {
  const lookup = new Map();
  const names = [];
  for (const entry of Array.isArray(cast) ? cast : []) {
    const name = String((typeof entry === 'string' ? entry : entry?.name) ?? '').trim();
    if (!name) continue;
    if (!names.includes(name)) names.push(name);
    if (!lookup.has(name)) lookup.set(name, name);
    for (const alias of Array.isArray(entry?.aliases) ? entry.aliases : []) {
      const spelling = String(alias ?? '').trim();
      if (spelling && !lookup.has(spelling)) lookup.set(spelling, name);
    }
  }
  const spellings = [...lookup.keys()].filter(spelling => [...spelling].length >= 2).sort((left, right) => right.length - left.length);
  return { lookup, names, spellings };
}

function canonical(value, { lookup, names }) {
  const wanted = String(value ?? '').trim();
  if (!wanted) return '';
  if (lookup.has(wanted)) return lookup.get(wanted);
  return unifySpeakerNames([wanted], names).get(wanted) ?? wanted;
}

/**
 * The names in one stretch of text, longest spelling first so a full name is never read as the short
 * one inside it, each with what stands right before and after it.
 */
function mentionsIn(text, { lookup, spellings }) {
  const source = String(text ?? '');
  const taken = [];
  const found = [];
  for (const spelling of spellings) {
    let from = 0;
    for (;;) {
      const at = source.indexOf(spelling, from);
      if (at < 0) break;
      from = at + spelling.length;
      if (taken.some(([start, end]) => at < end && from > start)) continue;
      taken.push([at, from]);
      found.push({ name: lookup.get(spelling), at, before: source.slice(Math.max(0, at - 8), at), after: source.slice(from, from + 4) });
    }
  }
  found.sort((left, right) => left.at - right.at);
  return found;
}

function isAddressee(mention) {
  return ZH_ADDRESSEE_RE.test(mention.before) || EN_ADDRESSEE_RE.test(mention.before) || JA_ADDRESSEE_RE.test(mention.after);
}

/** The person called by name inside a quote: at its head, or after a comma at its tail. */
function calledOut(text, cast) {
  const source = String(text ?? '');
  const candidates = [];
  const head = source.match(HEAD_CALL_RE)?.[1];
  if (head && cast.lookup.has(head.trim())) candidates.push(cast.lookup.get(head.trim()));
  const whole = source.replace(/[\s！!？?。.…～~，,]+$/u, '').trim();
  if (cast.lookup.has(whole)) candidates.push(cast.lookup.get(whole));
  const tail = source.match(TAIL_CALL_RE)?.[1];
  if (tail && cast.lookup.has(tail.trim())) candidates.push(cast.lookup.get(tail.trim()));
  return [...new Set(candidates)];
}

class Tally {
  constructor() {
    this.scores = new Map();
    this.evidence = new Map();
  }

  add(name, points, why) {
    if (!name) return;
    this.scores.set(name, (this.scores.get(name) ?? 0) + points);
    if (why && points > 0) {
      const list = this.evidence.get(name) ?? [];
      if (!list.includes(why)) list.push(why);
      this.evidence.set(name, list);
    }
  }

  best() {
    const ranked = [...this.scores].sort((left, right) => right[1] - left[1]);
    if (!ranked.length) return null;
    const [name, score] = ranked[0];
    const runnerUp = ranked[1]?.[1] ?? 0;
    if (score < CONFIDENT || score - runnerUp < MARGIN) return null;
    return { name, score, evidence: this.evidence.get(name) ?? [] };
  }
}

/**
 * A first look over the whole floor: who is named where, and how. A name that only ever stands
 * after 看着 or inside a quote is spoken to, never speaking; a name beside a verb of speech has
 * spoken outright; the translation's and the reader's labels count as speaking too.
 */
function surveyFloor(list, people, { hints, manual }) {
  const roles = new Map();
  const role = name => {
    if (!roles.has(name)) roles.set(name, { subject: 0, addressee: 0, explicit: 0, spoken: 0, called: 0 });
    return roles.get(name);
  };
  list.forEach((utterance, index) => {
    if (utterance.kind === 'quoted') {
      for (const name of calledOut(utterance.text, people)) role(name).called += 1;
      for (const source of [hints, manual]) {
        const named = source instanceof Map ? canonical(source.get(utterance.id), people) : '';
        if (named) role(named).spoken += 1;
      }
      return;
    }
    const spoke = speechVerbIn(utterance.text);
    const neighbour = (list[index - 1]?.kind === 'quoted' && list[index - 1].lineId === utterance.lineId)
      || (list[index + 1]?.kind === 'quoted' && list[index + 1].lineId === utterance.lineId);
    for (const mention of mentionsIn(utterance.text, people)) {
      if (isAddressee(mention)) role(mention.name).addressee += 1;
      else {
        role(mention.name).subject += 1;
        if (spoke && neighbour) role(mention.name).explicit += 1;
      }
    }
  });
  return roles;
}

/**
 * Who speaks each quoted utterance.
 *
 * `utterances` are the floor's, in order, as `splitUtterances` cuts them. `cast` lists the people the
 * reading knows, each as `{ name, aliases }` or a bare name; `protagonists` names the card's character
 * and the reader among them. `hints` are the speakers the translation named per utterance id;
 * `manual` the ones the reader set by hand. The reader's word is final; then what the text says
 * outright (a name beside a verb of speech, the script form); then the translation's label; then
 * what the text merely suggests — who acts beside the quote, who is called by name, who takes turns
 * with whom, who alone carries the floor. `infer: false` skips the text and keeps only the reader's
 * and the translation's words — for a language the labels were carried over to rather than read in.
 *
 * Returns a map from each quoted utterance's id to `{ speaker, source, confidence, evidence }`, with
 * `speaker` null where nobody could be named. Names come back as the cast spells them.
 */
export function resolveSpeakers(utterances, { cast = [], hints = null, manual = null, infer = true, protagonists = null } = {}) {
  const list = Array.isArray(utterances) ? utterances : [];
  const people = buildLookup(cast);
  const known = name => (people.lookup.has(String(name ?? '').trim()) ? canonical(name, people) : '');
  const character = known(protagonists?.character);
  const user = known(protagonists?.user);
  const result = new Map();
  const roles = infer ? surveyFloor(list, people, { hints, manual }) : new Map();
  // The reader counts as a speaker only where the text or a label has them speaking outright: in a
  // floor the character wrote, the reader's name is mostly the one being addressed.
  const speaksOutright = name => ((roles.get(name)?.explicit ?? 0) + (roles.get(name)?.spoken ?? 0)) > 0;
  // Who could be speaking at all: named as doing something, called by name, or labelled as speaking.
  const capable = [...roles].filter(([name, seen]) => (seen.subject > 0 || seen.called > 0 || speaksOutright(name)) && (name !== user || speaksOutright(name))).map(([name]) => name);
  const pair = capable.length === 2 ? capable : null;
  // One person carries the floor. With nobody named as speaking but the reader named as the one
  // spoken to, that person is the character: a floor written to the reader is the character talking.
  const addressedOnly = !capable.length && character && user && character !== user && (roles.get(user)?.addressee ?? 0) + (roles.get(user)?.called ?? 0) > 0;
  const sole = capable.length === 1 ? capable[0] : (addressedOnly ? character : null);
  const soleWhy = addressedOnly ? `这一楼里只有你被叫到，说话的是${character}` : '这一楼里只有这一个人在说话';
  // Who has been in the scene lately: the utterance index each name was last seen at.
  const present = new Map();
  let previous = null;
  const note = (name, index) => {
    if (name) present.set(name, index);
  };
  const around = (index, name) => [...present].filter(([, at]) => index - at <= PRESENT_WINDOW).map(([who]) => who)
    .filter(who => who !== name && (who !== user || speaksOutright(who)));

  list.forEach((utterance, index) => {
    if (utterance.kind !== 'quoted') {
      if (infer) for (const mention of mentionsIn(utterance.text, people)) note(mention.name, index);
      return;
    }
    const tally = new Tally();
    const sameLine = other => other && other.lineId === utterance.lineId;
    const before = sameLine(list[index - 1]) && list[index - 1].kind !== 'quoted' ? list[index - 1] : null;
    const after = sameLine(list[index + 1]) && list[index + 1].kind !== 'quoted' ? list[index + 1] : null;
    // The narration that closed the paragraph above, when this quote opens its own paragraph and that
    // paragraph spoke no quote of its own — a lead-in, not the tail of somebody else's line.
    const aboveRun = !before && index > 0 && !sameLine(list[index - 1]) && list[index - 1].kind !== 'quoted' ? list[index - 1] : null;
    const above = aboveRun && !list.some(other => other.lineId === aboveRun.lineId && other.kind === 'quoted') ? aboveRun : null;
    // Somebody outside the cast speaks here: a verb of speech beside the quote with no known name.
    const stranger = infer && [before, after].some(run => run && speechVerbIn(run.text) && !mentionsIn(run.text, people).length
      && !(ZH_PRONOUN_LEAD_RE.test(run.text) || EN_PRONOUN_LEAD_RE.test(run.text)));

    if (infer) {
      const scoreNarration = (run, where, { weak = false } = {}) => {
        if (!run) return false;
        const mentions = mentionsIn(run.text, people);
        if (!mentions.length) return false;
        const spoke = speechVerbIn(run.text);
        const snippet = `${where}「${shortSnippet(run.text)}」`;
        let subjectSeen = false;
        for (const mention of mentions) {
          if (isAddressee(mention)) {
            tally.add(mention.name, SCORE.addressee, '');
            continue;
          }
          if (!subjectSeen) {
            subjectSeen = true;
            const acting = mention.name === user && !spoke ? SCORE.userAction : (weak ? SCORE.paragraphAction : SCORE.action);
            tally.add(mention.name, spoke ? (weak ? SCORE.paragraphBefore : SCORE.attributed) : acting, snippet);
            if (JA_SUBJECT_RE.test(mention.after)) tally.add(mention.name, SCORE.subject, '');
          } else {
            tally.add(mention.name, SCORE.bystander, '');
          }
        }
        return true;
      };
      // Script form: the name alone, with or without a colon, right before the quote.
      const bare = before ? String(before.text).replace(/[\s：:]+$/u, '').trim() : '';
      if (bare && people.lookup.has(bare)) tally.add(people.lookup.get(bare), SCORE.script, `引号前「${shortSnippet(before.text)}」`);
      else scoreNarration(before, '引号前');
      scoreNarration(after, '引号后');
      if (!before && !tally.scores.size) scoreNarration(above, '上一段末尾', { weak: true });
      // 「他说道」 beside the quote, with one person in the scene: that person.
      for (const [run, where] of [[before, '引号前'], [after, '引号后']]) {
        if (!run || !(ZH_PRONOUN_LEAD_RE.test(run.text) || EN_PRONOUN_LEAD_RE.test(run.text)) || !speechVerbIn(run.text)) continue;
        const here = around(index, null);
        if (here.length === 1) tally.add(here[0], SCORE.pronoun, `${where}「${shortSnippet(run.text)}」，场上只有这一个人`);
      }

      // Whoever is called by name inside the quote is being spoken to.
      const called = calledOut(utterance.text, people);
      for (const name of called) {
        note(name, index);
        tally.add(name, SCORE.calledOut, '');
        if (name === user && character && character !== user) tally.add(character, SCORE.toUser, `话里叫的是${name}（你），说话的是${character}`);
        else if (name === character && user && speaksOutright(user)) tally.add(user, SCORE.toCharacter, '');
        const others = pair ? pair.filter(who => who !== name) : around(index, name);
        if (others.length === 1) tally.add(others[0], SCORE.answering, `话里叫的是${name}`);
      }

      // The rhythm of the exchange.
      if (previous?.speaker && sameLine(list[previous.index])) {
        const between = list.slice(previous.index + 1, index);
        const namesBetween = between.some(run => run.kind !== 'quoted' && mentionsIn(run.text, people).length);
        if (!namesBetween && !stranger) tally.add(previous.speaker, between.length ? SCORE.sameLineNarrated : SCORE.sameLine, '同一段里接着上一句');
      } else if (!stranger) {
        if (pair && pair.includes(user)) {
          // The reader and one other: what the text does not hand to the reader outright is the other's.
          const other = pair.find(who => who !== user);
          tally.add(other, SCORE.sole, `这一楼里只有${other}和你，没写名字的话算${other}的`);
        } else if (pair) {
          if (previous?.speaker && pair.includes(previous.speaker)) tally.add(pair.find(who => who !== previous.speaker), SCORE.alternation, `和${previous.speaker}轮流说话`);
        } else if (sole) {
          tally.add(sole, SCORE.sole, soleWhy);
        } else if (previous?.speaker) {
          const others = around(index, previous.speaker);
          if (others.length === 1) tally.add(others[0], SCORE.alternation, `和${previous.speaker}轮流说话`);
          else if (!others.length) tally.add(previous.speaker, SCORE.carryOn, '');
        }
      }
    }

    let entry = null;
    const chosen = manual instanceof Map ? canonical(manual.get(utterance.id), people) : '';
    if (chosen) {
      entry = { speaker: chosen, source: 'manual', confidence: 1, evidence: [SPEAKER_SOURCE_LABELS.manual] };
    } else {
      const best = infer ? tally.best() : null;
      const hinted = hints instanceof Map ? canonical(hints.get(utterance.id), people) : '';
      const local = best ? { speaker: best.name, source: 'local', confidence: Math.min(1, best.score / 100), evidence: best.evidence } : null;
      // What the text says outright beats the translation's label; what it only suggests does not.
      if (local && best.score >= EXPLICIT) entry = local;
      else if (hinted) entry = { speaker: hinted, source: 'hint', confidence: 0.6, evidence: [SPEAKER_SOURCE_LABELS.hint] };
      else if (local) entry = local;
      else entry = { speaker: null, source: null, confidence: 0, evidence: [] };
    }
    result.set(utterance.id, entry);
    note(entry.speaker, index);
    previous = { index, lineId: utterance.lineId, speaker: entry.speaker };
  });
  return result;
}

/** The speakers a set of labels names, by utterance id: the translation's word, handed on as hints. */
export function speakerHints(labels) {
  const hints = new Map();
  for (const [id, label] of labels instanceof Map ? labels : []) if (label?.speaker) hints.set(id, label.speaker);
  return hints;
}

/**
 * The labels with the resolved speakers written over them.
 *
 * A resolved name replaces whatever the label said. A quote the resolver named nobody for keeps the
 * label's own speaker — the model's or the translation's, whichever `fallback` says it came from,
 * unless the label already says — and otherwise has none. Labels of utterances the resolver did not
 * see — narration, or lines the model called dialogue — stay as they are.
 */
export function pinSpeakers(labels, resolved, { fallback = 'model' } = {}) {
  const out = new Map();
  for (const [id, label] of labels instanceof Map ? labels : []) out.set(id, { ...label });
  for (const [id, entry] of resolved instanceof Map ? resolved : []) {
    const had = out.get(id) ?? null;
    const label = { ...(had ?? {}) };
    if (entry?.speaker) {
      // A label carried over from the other language keeps saying where its name was read.
      const carried = entry.source === 'hint' && label.speaker === entry.speaker && had?.speakerSource;
      label.speaker = entry.speaker;
      label.speakerSource = carried ? had.speakerSource : entry.source;
      label.speakerEvidence = carried ? [...(had.speakerEvidence ?? [])] : [...(entry.evidence ?? [])];
    } else if (label.speaker) {
      label.speakerSource = had?.speakerSource ?? fallback;
      label.speakerEvidence = [...(had?.speakerEvidence ?? [])];
    } else {
      delete label.speakerSource;
      delete label.speakerEvidence;
    }
    if (Object.keys(label).length) out.set(id, label);
    else out.delete(id);
  }
  return out;
}

/** The resolved speaker names alone, by id, for a request that should know who speaks. */
export function speakersOf(resolved) {
  const map = new Map();
  for (const [id, entry] of resolved instanceof Map ? resolved : []) if (entry?.speaker) map.set(id, entry.speaker);
  return map;
}
