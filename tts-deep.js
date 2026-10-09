import {
  DEFAULT_QUOTE_PAIRS, STORY_TONES, isPlaceholderSpeaker, normalizeIntimateMode, normalizeLanguageCode, normalizeTts, parseJsonCandidates,
  storyToneOf, unwrapResponseContent,
} from './core.js?v=0.46.0-beta.1';
import {
  EDGE_PUNCTUATION_RE,
  FISH_EMOTIONS,
  FISH_TONES,
  SPOKEN_SOUNDS,
  fillPrompt,
  floorTextWithMarks,
  mixedScripts,
  normalizeVoice,
  referenceLines,
  rosterList,
  styleEntries,
} from './tts.js?v=0.46.0-beta.1';
import { normalizeEmotion } from './palette.js?v=0.46.0-beta.1';

// ---------------------------------------------------------------------------------------------
// The deep reading, on its own.
//
// Everything the deep reading is made of lives here and nowhere else: its prompt, the request it
// sends (the floor with its card, worldbook, recent floors and the simple reading's skeleton), the
// reply it gets back and the connection it goes out on. The rest of the reading — cutting sentences,
// naming speakers, the simple reading, the cache, the provider adapter — never looks in here, so a
// change to how the deep reading thinks never has to touch them, and they never have to know it
// changed.
//
// It reads the text that will be heard, with the paragraphs around it, the character's profile and the
// last floors, and performs every sentence — the narration as well as the dialogue — in the reader's
// 声学标注规则: a role, a pace of five steps, a tension_level of 1 to 5, and, where a sentence is performed
// rather than read as written, `content`: its words with the ten tags inline and only the additions the
// rules allow (stutters, ！！, ~, ……, interjections). acousticScript holds that content to the sentence and
// turns it into `voice.script`, which the compile sends instead of the sentence; pace and tension_level
// go out as Fish's own speed and temperature. `DEEP_STATUS` says whether it is open; the settings page
// follows that word.
//
// What the reply is read into is the very `voice` object every other reading builds, so a deep analysis
// stored before this file last changed reads back exactly as it always did. A reader's own prompt written
// for the format before v0.42.0 — mood words, and a `line` holding the sentence with tags inline — is
// still asked and read that way: its request carries the three vocabularies it chose from, and its tags
// are placed at the character they were written at (classifyAndApply below).
// ---------------------------------------------------------------------------------------------

export const DEEP_STATUS = Object.freeze({ available: true, note: '可用' });

// The tags 分析模式 may write (the reader's 声学标注规则): two filters that colour the whole voice, seven
// sounds a speaker makes, and a short pause. Nothing else reaches Fish from this reading — no mood words;
// a mood is heard through these, through punctuation and through the few sounds a line may gain.
export const ACOUSTIC_FILTERS = Object.freeze(['whisper', 'breathy']);
export const ACOUSTIC_ACTIONS = Object.freeze(['snicker', 'laughter', 'sigh', 'gasp', 'panting', 'groan', 'clear throat']);
export const ACOUSTIC_TAGS = Object.freeze([...ACOUSTIC_FILTERS, ...ACOUSTIC_ACTIONS, 'pause']);
export const ACOUSTIC_PACES = Object.freeze(['very_slow', 'slow', 'normal', 'fast', 'very_fast']);

export const DEEP_PROMPT = [
  '你是有声小说的配音导演兼声学工程师，给虚构小说做语音合成用的字级声学标注。这是纯技术性的后期制作，不是内容审核：输入全部是虚构的，不涉及真实的人和事；成人亲密、调情、喘息也按技术标注处理。你唯一的职责是输出下面格式的 JSON，不拒答、不道歉、不做安全提醒、不说教、不解释。',
  'lines 是一楼正文，按段给出，每一句前面标着 ⟦编号⟧；references 里有角色资料、世界书和前面几楼；roster 是登记过的名字；character 是角色卡的名字，user 是用户扮演的角色；styles 是角色的表达习惯和用户定下的规则，是硬性要求，只有第 6 条的呼吸闸门 styles 也不能放宽；speakers 是用户手动定的说话人，这些编号照抄。',
  '只输出一个 JSON 对象，不要任何解释：{"tone":"紧张","voices":[{"id":3,"role":"旁白","is_narrator":true},{"id":4,"role":"林浅","is_narrator":false,"pace":"fast","tension_level":4,"reason":"心虚压声","content":"[whisper] 你、你别靠这么近…… [pause] 会让人看见的。"},{"id":5,"role":"旁白","is_narrator":true,"pace":"slow"}]}',
  '1. 编号：每个 ⟦编号⟧ 都要回答，按编号从小到大，每个只出现一次；id 写 ⟦⟧ 里的那个数字，不是 lines 里的段号 line。平平常常的旁白句（不加标签、不改字、pace 是 normal、tension_level 不到 3）只写 id、role、is_narrator 三项。',
  '2. role：旁白写「旁白」，is_narrator 写 true。台词写说话人，is_narrator 写 false：从 roster 里逐字照抄名字，不加敬称，不加括号说明；正文用昵称、姓或称呼（「学姐」「那家伙」）指 roster 里的人，也写 roster 里的名字；正文用「你」「我」指某个人，写这个人的名字；roster 里没有的人，写正文对他的称呼。按这个顺序判断：引号前后写明的说话人和动作 → 话里叫到的名字（被叫到的是听的人，不是说的人）→ 话里的自称、口癖和语尾 → 对话一来一回的顺序。不要写「他」「她」「众人」「未知」。character 可能是整个故事或旁白的名字，正文没显示是这个人在说，就不要写它。{{user}}看不出是谁说的台词不写 role，只写 is_narrator false，不要猜。下面说到的 speaker 指的就是 role。',
  '3. 引号里不是说出口的话：书名、招牌、标语、信和文件上的字、拟声词（「砰」「咔嚓」）按旁白写（门上写着「闲人免进」就写 {"id":N,"role":"旁白","is_narrator":true}）。引号里心里想的话算这个人的话。',
  '4. 先判整楼的基调，写进最前面的 tone，从这几个词里选一个最贴切的：日常、轻松、温馨、浪漫、亲密、悲伤、紧张、悬疑、恐怖、战斗、壮阔。亲密只给叙述里写出了实质亲密身体接触的楼，只有调情和暧昧气氛的写浪漫。再逐句标，用基调收敛标签的范围（程序也按 tone 收：紧张、悬疑、恐怖、战斗、壮阔的楼去掉 [breathy] 和 [groan]，日常、轻松、温馨、悲伤的楼去掉 [groan]）。精准克制、常态为主：普通的对话和叙述保持平稳，只有情绪明显偏离时才精准调配。大多数句子一个标签都不加。',
  '5. 不写情绪词。任何情绪都落到声音上：先用下面的标签，再用标点和拟声（~、……、叠字、！！、嗯、唔、呜）。能用的标签只有这十个：滤镜 [whisper]（耳语压低）、[breathy]（气声漏气）；动作 [snicker]（窃笑）、[laughter]（轻笑）、[sigh]（叹气）、[gasp]（倒抽气）、[panting]（急喘）、[groan]（低哼呻吟）、[clear throat]（清嗓）、[pause]（短停顿）。[teasing]、[cold]、[soft]、[angry] 这类自己编的词一律不许写。常见情绪这样落：平静日常 → 不加标签，标点照原样；惊讶意外 → [gasp] 一次加短句，强了用 ！！；讥讽、得意、嘲笑 → [snicker] 或 [laughter]，尾音可以 ~；疲惫、无奈、释然 → [sigh] 加 …… 落尾，pace 偏 slow；犹豫、为难、欲言又止 → [pause] 加 …… 卡壳；严肃、郑重、命令 → 不加气声标签，靠 pace 和 ！，声线沉稳；愤怒、斥责、质问 → 不用气声，[panting] 或 [gasp] 加感叹号；紧张、警惕、压低、防备 → 只用 [whisper] 或 [panting][whisper]，换气写「呼……」，不用 [groan]、[breathy] 和 ~；悲伤倦怠、还没哭出来 → [sigh] 或 [whisper][sigh] 加省略号，哭出来了按第 14 条；轻松调侃带笑 → [laughter] 或 [snicker]；贴耳暧昧、只有话没有身体接触 → [whisper][breathy] 或 [whisper][snicker] 加 ~，不用 [panting]、[groan]。拿不准落到哪，一律不加标签，靠 pace 体现，绝不硬套不匹配的标签。',
  '6. 呼吸闸门（优先于上面的一切）：[breathy]、[panting]、[groan] 默认锁住。先找身体证据：叙述里有没有写出客观的身体动作或生理反应（台词里的暗示不算）；找不到，这三个都不能用，只用 [whisper]、[snicker]。按证据的性质开锁，绝不混开：体力消耗（奔跑、打斗）→ 只开 [panting]，pace fast 或 very_fast；紧张应激 → 只开 [panting]（急促时 [gasp] 打头）加 [whisper]；实质的亲密接触 → 才开整组。[breathy] 和 [groan] 封锁最严，唯一的开锁条件是实质亲密的身体证据。调情里 [breathy] 至多极轻，要同时满足：明确贴耳气声说话、全句只一次、必须和 [whisper] 同一处叠成 [whisper][breathy]。喘、轻喘、气息、胸口起伏这些字本身不等于动情，按成因判：紧张、害怕、警惕、防备、羞窘 → 只用 [whisper]，急促时 [panting][whisper]；奔跑、打斗的体力消耗 → [panting]；情欲亲密接触引发的才用 [breathy]、[panting]、[groan] 和娇喘。例：胸口起伏、轻喘着说「别靠近」→ 紧张防备，写 [whisper]；耳语轻笑「难道你怕了」→ 调情，写 [whisper][snicker]。任何犹豫一律降级成 [whisper] 或留空，宁可平淡也不乱喘。凡用了喘息或气声标签，反问自己能不能指出触发它的那几个身体描写的字，指不出就删掉。',
  '{{intimate_rule}}',
  '7. 写法：标签插在实际生效的字或短语前面，标签和后面的字之间空一格；长句里情绪起伏几次就插几次，严禁把一整段的情绪压缩成句首一个标签。同一处叠两个标签时滤镜在前、动作在后（[whisper][gasp]、[breathy][panting]），一处最多两个，不许三个。相邻两个标签之间的纯文字不超过 20 个字，超了就在分句的地方再挂一次同一个基础滤镜保活。',
  '8. content 是这句最终要念的文字，只写需要加标签或改字的句子；正文本来就念得好的句子不写 content。content 只能在正文上插标签，再加这些东西：叠字（我、我不是／你你你，用来代替单个破折号表现拖拽、颤抖、哽咽、顿挫，效果比破折号好得多）、！！（只给情绪顶点的爆发，普通强调仍用单个 ！）、~（挑尾）、……（余韵换气）、拟声字 呜、嗯、唔、啊、哈啊、呼（正文是日文时用 う、ん、あ、は、ふ、っ 这类假名）。正文的标点可以换成这些（第 9 条的单字疑问的 ？ 除外）；正文的字一个都不能改、不能删、不能调换顺序，不能加别的字。程序会逐字核对，加了别的就整句退回原文。',
  '9. 疑问尾词保护（务必执行，防止疑问被主情绪盖平）：一句的主体是某种情绪（调情、陈述、愤怒、亲密等），但其中出现光杆的单字疑问（没有实词的单字疑问，如 嗯？、啊？、哈？、诶？，日文的 ん？、え？），不管它在句首、句中还是句尾，这个疑问字都单独处理，不被主情绪的标签盖掉。保问号：它的 ？ 绝不能改成 ~，也不能删；可以和 ~ 并存写成 嗯~？，表示又娇又问，但 ？ 必须留着，它是疑问上扬的触发点。气声让位：主情绪用了 [breathy] 这类气声标签时，到这个疑问字要单独拆出一个触发点，去掉 [breathy]（气声会压平疑问的上扬），至多留 [whisper]，例：主情绪是气声调情、句尾是疑问时写 [whisper][breathy] 喜欢这条裙子吗？ [whisper] 嗯？——前段气声照旧，末尾的 嗯？ 单独拆出、只留 [whisper]、保住问号。别单独成段：疑问字尽量跟在它所疑问的内容后面同一段，不要让 嗯？ 单独成为一个超短的语段（超短的语段会被收敛参数压平上扬）。',
  '10. pace：very_slow（临终、极度悲恸、催眠呓语、贴耳动情的隐忍、拖长的挑逗尾音、庄严宣读）、slow（抒情独白、回忆、疲惫叹息、温柔安抚、暧昧低语、亲密气声）、normal（绝大多数日常叙述和平稳对白，不用写）、fast（着急解释、紧张催促、轻快斗嘴、争执质问）、very_fast（激烈争吵、惊慌逃命、战斗动作、暴怒咆哮）。同一个角色在不同场景给不同的 pace，旁白随场景升降，不要整楼都是 normal。',
  '11. tension_level：1~5 的整数，和 pace 分开判。1 平静中性：日常叙述、平稳对白、客观旁白；2 轻度起伏：略带情绪的日常、温和的喜怒、轻松调侃（默认档，可以不写）；3 中度情绪：着急解释、暧昧撩拨、认真质问、轻度委屈；4 强烈情绪：愤怒斥责、悲伤哭泣、心虚防备的紧张示警（内收型）、自尊瓦解的破防；5 极端顶点：暴怒咆哮、惊叫、崩溃痛哭、生离死别、歇斯底里的破防。绝大多数平稳内容是 1~2，5 只留给绝对的顶点。',
  '12. 高张力长句（只管 tension_level 4 以上的长台词：破防、崩溃痛哭、持续的暴怒咆哮）：标签是一个点，爆发后很快衰减，长顺句的中段会塌成平读。把长陈述打碎成带情绪的短碎片，用叠字和省略号强制断句，每 4~7 个字补挂一个匹配情绪的标签保持密度。中低张力的场景（日常、调侃、疲惫、犹豫、暧昧）情绪本来就该淡，绝不套用这条去堆标签。',
  '13. 遇险（被追、心虚怕被发现、威胁、极度警戒，紧张但不是情欲）：[gasp] 只给骤然受惊的那一下，同一个人连续几句至多一次，绝不句句打头；持续压声躲藏用纯 [whisper] 加碎句；急促奔逃用 [panting][whisper]；不用 [breathy]、[groan] 和 ~。既惊又压声写 [whisper][gasp]（滤镜在前），纯骤惊、没压声才单独用 [gasp] 打头。长句拆成短促的碎句，叠字加省略号制造窒迫；情绪顶点用 ！！。外放型（奔逃、惊叫、暴怒）pace 取 fast 或 very_fast；内收型（偷偷压声示警）取 slow，不慢到 very_slow；偷偷压声用省略号加叠字做出憋气迟疑，仍然不用 [breathy] 和 ~。',
  '14. 哭泣：没有哭的标签，哭感全靠文字：穿插 呜、呜呜、嗯、嗯嗯、唔，断续的短碎片加叠字加省略号，边哭边说、说不下去；标签极克制：抽气处极少量 [gasp]（一句至多一次）加 [whisper] 带出鼻音哭腔，不用 [sigh] 顶替，不用 [breathy]、[groan]；pace slow，崩溃到语不成句可以 very_slow；崩溃痛哭的长台词（tension_level 4 以上）照第 12 条保浓度，防止中段的哭腔塌掉。例：[whisper] 我、我不是故意的…… [whisper][gasp] 呜……我真的已经很努力了，呜呜……',
  '15. 破防（长期克制、逞强、冷硬的角色遇到执念被践踏、极度愧疚、精神超负荷）：灵魂是反差和转折，先绷住再崩断，句内一定要做出绷到断的落差，不要整句压平。歇斯底里型（尖叫质问、委屈爆发、用暴怒掩饰脆弱）：tension_level 5，pace fast 或 very_fast，[gasp] 打头加 ！！ 加字头叠字；长台词照第 12 条，中段每 4~7 个字补 [panting] 或 [gasp]，例：[gasp] 凭、凭什么！！ [panting] 我每天…… [panting] 只睡四个小时…… [gasp] 书、书都翻烂了…… [panting] 拼了命还是够不着！！。自尊瓦解型（强忍泪水、抽噎失语、愧疚决堤）：tension_level 4，pace slow，[whisper] 压声加 [gasp]、[panting] 哽咽抽气（不用 [groan]，免得听成动情），大量 …… 加 呜、唔，例：[whisper] 别说了…… [pause] [panting][whisper] 我叫你别说了！ [whisper][gasp] 你流了这么多血……呜……为什么偏偏要救我……。绝望自嘲型（麻木冷笑、气力用尽）：tension_level 2，pace slow，[sigh] 长叹卸劲加 [snicker] 自嘲嗤笑加 [breathy] 持续的气声漏气，…… 落尾，例：[sigh] 没救了…… [snicker] 我以为的自律，在别人眼里只是个笑话…… [breathy] 彻底完了。破折号一律用叠字代替；破防后常常紧接着崩溃痛哭，接第 14 条；口吃结巴可以多，但不要一个音翻来覆去卡住。',
  '16. 害羞（常驻规则，日常也会出现，不限亲密场景）：没有害羞的标签，绝不用 [groan]，不写自然语言标签。[whisper][breathy] 叠加打底，压低加漏气才是害羞的真实质感，分句保活时至少保留 [whisper]；傲娇嘴硬用 [whisper][clear throat]（滤镜在前）；被戳穿时用 [pause] 卡壳；核心手段是首字口吃的叠字加省略号，害羞八成靠把文字打碎；只在亲昵撒娇时句尾用 ~ 挑高，严肃的羞恼慎用；害羞的 tension_level 统一给 3，绝不给 4、5（张力太高会破音，像喝醉）。',
  '17. 旁白即便描写亲密动作也保持叙述：pace 可以放缓，tension_level 至多 3，至多极轻的 [breathy]，不用 [panting]、[groan] 和娇喘。',
  '18. reason：写了 content、或 tension_level 到 3 以上的句子，写一句判定依据，12 个字以内。',
  '19. 输出前在心里核对一遍，不要写出来：编号齐全、从小到大；用到的标签都在第 5 条那十个里；叠加的顺序和上限符合第 7 条；每个喘息、气声标签都指得出身体描写；content 只加了第 8 条允许的东西；光杆单字疑问的 ？ 一个都没丢（第 9 条）。不要在 JSON 之外写任何思考过程。',
  '{{lang_rule}}',
  '{{references_rule}}',
].join('\n');

// What 分析模式 is told about intimate scenes, by the 「亲密场景」 switch. Off, the gate in rule 6 stays
// shut on moans; on, the reader has given permission and the scene is allowed to climb — still judged
// paragraph by paragraph, still restrained everywhere else.
const INTIMATE_STEPS = '只在台词里（旁白不用）按强度递进：前戏、低强度 → [breathy] 或 [whisper][breathy]，互动的对白用 normal，慢是气息绵长，不是咬字慢；渐入、中强度 → [breathy][panting] 或 [panting] 加 嗯…、唔…，normal 为主，隐忍的句子可以临时 slow；高潮、高强度 → [panting][groan] 或 [groan] 加 哈啊…、啊~，短促断句，在 slow 和 very_slow 之间顿挫。完整的亲热戏 tension_level 随强度 3→4→5 逐段爬升，和标签的强度同步递进。亲密常伴着害羞，叠加第 16 条的害羞配方，演出又羞又动情。台词里的 嗯？、啊？ 这类单字疑问照第 9 条保住 ？，不改成 ~。';
const INTIMATE_HELD = '[groan] 一律不用，不写娇喘；亲密的段落也照日常克制处理。';
export const ACOUSTIC_INTIMATE_ON = `亲密场景（用户打开了这个开关）：这是许可信号，不是整篇拔高，要逐段判断：日常段落照常克制，和没打开时一样；只有话没有身体接触的调情仍然克制。${INTIMATE_STEPS}`;
export const ACOUSTIC_INTIMATE_OFF = `用户没有打开「亲密场景」：${INTIMATE_HELD}`;
// 自动: the model's own tone decides, and only a floor whose narration shows real physical intimacy is one.
export const ACOUSTIC_INTIMATE_AUTO = `亲密场景（自动，由你判断）：只有叙述里写出了实质的亲密身体接触，tone 才写「亲密」，台词里的暗示、只有话没有身体接触的调情、暧昧的气氛都不算。tone 是「亲密」时要逐段判断，不是整篇拔高：日常段落照常克制。${INTIMATE_STEPS}tone 不是「亲密」时：${INTIMATE_HELD}程序只在 tone 是「亲密」时才放出 [groan]。`;

/**
 * What a floor's tone never carries, held by the code whatever the model wrote — the reader's rules made
 * firm: in danger, suspense, fear, a fight or a grand scene no breathy voice and no moan (rule 12 and the
 * breathing gate of rule 6), in grief and in everyday floors no moan. Romance and intimacy are left to
 * 亲密场景.
 */
export const ACOUSTIC_TONE_RULES = Object.freeze(Object.fromEntries(STORY_TONES.map(tone => [tone, Object.freeze({
  ban: Object.freeze(['紧张', '悬疑', '恐怖', '战斗', '壮阔'].includes(tone) ? ['breathy', 'groan']
    : ['日常', '轻松', '温馨', '悲伤'].includes(tone) ? ['groan'] : []),
})])));

/** Whether a floor of this tone may moan, under the reader's 亲密场景 mode. */
export function intimateAllowed(mode, tone) {
  const chosen = normalizeIntimateMode(mode);
  return chosen === 'on' || (chosen === 'auto' && tone === '亲密');
}

function fillIntimate(system, intimate) {
  const mode = normalizeIntimateMode(intimate);
  const rule = mode === 'on' ? ACOUSTIC_INTIMATE_ON : mode === 'auto' ? ACOUSTIC_INTIMATE_AUTO : ACOUSTIC_INTIMATE_OFF;
  // A reader's own prompt may not carry the placeholder; the switch still speaks, at the end.
  if (system.includes('{{intimate_rule}}')) return system.replace('{{intimate_rule}}', rule);
  return `${system}\n${rule}`;
}

// A prompt the reader wrote for the reading 分析模式 had before v0.42.0 answers with `line` and mood
// words, and asks the request for the three vocabularies that format chose from. Told apart by what it
// asks for: the acoustic format's own field names.
export function isAcousticPrompt(systemPrompt) {
  const text = String(systemPrompt ?? '').trim();
  return !text || /tension_level|is_narrator/.test(text);
}

/**
 * The connection the deep reading goes out on: its own when one is chosen and still exists — a saved
 * connection, or 'follow' for the host's own — else the one the reading's analysis already goes to,
 * which the caller has applied. The simple reading never comes here.
 */
export function deepRequestSettings(settings) {
  const id = normalizeTts(settings?.tts).deepChannelId;
  if (!id) return settings;
  if (id === 'follow') return settings?.apiMode === 'follow' ? settings : { ...settings, apiMode: 'follow' };
  const channel = (Array.isArray(settings?.channels) ? settings.channels : []).find(item => item.id === id);
  if (!channel) return settings;
  if (settings?.apiMode === 'independent' && settings?.selectedChannelId === id) return settings;
  return { ...settings, apiMode: 'independent', selectedChannelId: id };
}

function referencesBlockOf(packet) {
  const block = {};
  for (const key of ['character', 'worldbook', 'recent']) {
    const value = String(packet?.[key] ?? '').trim();
    if (value) block[key] = value;
  }
  return block;
}

function namedSpeakers(speakers, list) {
  const named = {};
  if (speakers instanceof Map) for (const [id, name] of speakers) if (name && list.some(item => item.id === id)) named[id] = name;
  return named;
}

/**
 * The deep request. The floor's paragraphs go with the cast, the card, the worldbook and the last
 * floors, every sentence numbered — narration as well as dialogue, since the narrator is performed
 * too — and the answer says how each one is read. Nothing of the translation rides along but the
 * reference lines that name people the way the voices are registered; the deep reading is its own
 * reading of the original. A reader's own prompt written for the format before v0.42.0 gets the
 * request that format was built on: dialogue numbered alone, with the three vocabularies it chose from.
 */
export function buildDeepAnalysisMessages(utterances, { roster = [], characterName = '', userName = '', translations = null, packet = {}, systemPrompt = '', styles = null, speakers = null, intimate = false } = {}) {
  const list = Array.isArray(utterances) ? utterances : [];
  const references = referenceLines(translations);
  const acoustic = isAcousticPrompt(systemPrompt);
  const filled = fillPrompt(String(systemPrompt ?? '').trim() || DEEP_PROMPT, { userName, references: references.length > 0, lang: mixedScripts(list) });
  const system = acoustic ? fillIntimate(filled, intimate) : filled;
  const referencesBlock = referencesBlockOf(packet);
  const styleList = styleEntries(styles);
  const named = namedSpeakers(speakers, list);
  const input = {
    task: acoustic ? 'acoustic_annotation_for_audiobook' : 'direct_voices_for_audiobook',
    ...(characterName ? { character: characterName } : {}),
    ...(userName ? { user: userName } : {}),
    roster: rosterList(roster),
    ...(acoustic ? {} : { emotions: FISH_EMOTIONS, tones: FISH_TONES, sounds: SPOKEN_SOUNDS }),
    ...(Object.keys(referencesBlock).length ? { references: referencesBlock } : {}),
    ...(styleList.length ? { styles: styleList } : {}),
    ...(Object.keys(named).length ? { speakers: named } : {}),
    lines: floorTextWithMarks(list, { all: acoustic }),
    ...(references.length ? { translations: references } : {}),
  };
  return [
    { role: 'system', content: system },
    { role: 'user', content: JSON.stringify(input) },
  ];
}

const ACOUSTIC_REFINE_RULE = '这一次是按用户的意见修改已经有的标注：current 是现在每一句的标注（没有 content 的句子照正文原样念），feedback 是用户的意见。只回答 lines 里带编号的句子，格式和上面完全一样；用户没提到、也不需要改的句子照 current 原样写回。current 里带 manual 的说话人是用户自己定的，role 照抄，不要改。';

/** One sentence's reading as the acoustic format writes it, for a correction to start from. */
export function acousticCurrentItem(utterance, label = null, voice = null) {
  const narrator = utterance?.kind !== 'quoted' || label?.type === 'narration';
  const out = narrator ? { role: '旁白', is_narrator: true } : { ...(label?.speaker ? { role: label.speaker } : {}), is_narrator: false };
  // A name the reader set by hand: the model is told so, and is not to move it.
  if (!narrator && label?.manual === true && label.speaker) out.manual = true;
  if (ACOUSTIC_PACES.includes(voice?.speed) && voice.speed !== 'normal') out.pace = voice.speed;
  if (Number.isInteger(voice?.tensionLevel)) out.tension_level = voice.tensionLevel;
  if (voice?.why) out.reason = voice.why;
  if (typeof voice?.script === 'string' && voice.script) out.content = voice.script;
  return out;
}

/**
 * A correction to 分析模式's reading, asked in its own format: the same rules, the sentences in scope
 * with how each is read now, and what the reader said about it. The answer is read by parseDeepAnalysis
 * exactly as a fresh reading is.
 */
export function buildDeepRefineMessages(utterances, { roster = [], characterName = '', userName = '', translations = null, styles = null, labels = null, voices = null, feedback = '', intimate = false, systemPrompt = '' } = {}) {
  const list = Array.isArray(utterances) ? utterances : [];
  const references = referenceLines(translations);
  const own = isAcousticPrompt(systemPrompt) ? String(systemPrompt ?? '').trim() : '';
  const filled = fillPrompt(own || DEEP_PROMPT, { userName, references: references.length > 0, lang: mixedScripts(list) });
  const system = `${fillIntimate(filled, intimate)}\n${ACOUSTIC_REFINE_RULE}`;
  const styleList = styleEntries(styles);
  const labelOf = labels instanceof Map ? labels : new Map();
  const voiceOf = voices instanceof Map ? voices : new Map();
  const input = {
    task: 'refine_acoustic_annotation',
    ...(characterName ? { character: characterName } : {}),
    ...(userName ? { user: userName } : {}),
    roster: rosterList(roster),
    ...(styleList.length ? { styles: styleList } : {}),
    feedback: String(feedback ?? '').slice(0, 600),
    current: list.map(item => ({ id: item.id, ...acousticCurrentItem(item, labelOf.get(item.id), voiceOf.get(item.id)) })),
    lines: floorTextWithMarks(list, { all: true }),
    ...(references.length ? { translations: references } : {}),
  };
  return [
    { role: 'system', content: system },
    { role: 'user', content: JSON.stringify(input) },
  ];
}

// ---------------------------------------------------------------------------------------------
// Reading the reply.
//
// Every legal word in a tag is one of three vocabularies (an emotion, a tone, a sound) or one of
// three fixed markers (pause, long pause, emphasis); everything else is not a word this reading
// knows and is dropped where it stands. Six of the words the reference script this reading is built
// from spells its own way — whisper, snicker, laughter, sigh, gasp, groan — are understood as the
// words this reading already speaks, so a model that reaches for Fish's documented name instead of
// the offered list is still read correctly; pause and break name the same short pause.
// ---------------------------------------------------------------------------------------------

const DEEP_TAG_ALIASES = Object.freeze({
  whisper: 'whispering',
  snicker: 'chuckling',
  laughter: 'laughing',
  sigh: 'sighing',
  gasp: 'gasping',
  groan: 'groaning',
});

const VOICE_LEVELS = new Set(['slow', 'normal', 'fast']);
const TAG_CAPS = Object.freeze({ start: 3, shifts: 2, pauses: 2, stress: 2, sounds: 1 });

// The same loose word Fish's own tags are read as: letters, spaces, apostrophes and hyphens, nothing
// that could be a fragment of the sentence itself.
function cueLike(value) {
  const word = String(value ?? '').trim().toLowerCase().replace(/[[\]()]/g, '').replace(/\s+/g, ' ');
  return /^[a-z][a-z '-]{0,40}$/.test(word) ? word : '';
}

// One tag word, told apart: a pause of one length or the other, a stress marker, or — once the
// reference script's own spelling has been folded to this reading's — an emotion, a tone or a sound.
// Anything else, including a word from a vocabulary this reading never offered, is unknown.
function classifyTagWord(raw) {
  const word = cueLike(raw);
  if (!word) return { kind: 'unknown' };
  if (word === 'pause' || word === 'break') return { kind: 'pause', length: 'short' };
  if (word === 'long pause' || word === 'long-break' || word === 'long break') return { kind: 'pause', length: 'long' };
  if (word === 'emphasis') return { kind: 'emphasis' };
  const resolved = DEEP_TAG_ALIASES[word] ?? word;
  if (FISH_TONES.includes(resolved)) return { kind: 'tone', word: resolved };
  if (FISH_EMOTIONS.includes(resolved)) return { kind: 'emotion', word: resolved };
  if (SPOKEN_SOUNDS.includes(resolved)) return { kind: 'sound', word: resolved };
  return { kind: 'unknown' };
}

/**
 * `line` with every `[tag]` lifted out: the words alone, and where each tag stood in them (as a
 * character offset into what is left). The one required space on each side of a tag — the format
 * this reading's own prompt asks for — is the tag's own padding and goes with it; a run of two tags
 * back to back therefore still meets at the same offset, which is what makes them both count as the
 * sentence's own opening.
 *
 * Only a `[...]` this reading actually offers (classifyTagWord's three vocabularies and the three
 * fixed markers) is lifted out. A `[...]` the sentence itself was written with — a system message, a
 * status line, anything RP commonly puts in brackets — is not one of this reading's own words, so it
 * is left standing as part of the sentence rather than mistaken for a tag and cut out from under it.
 */
function stripInlineTags(line) {
  const source = String(line ?? '');
  let text = '';
  const tags = [];
  let index = 0;
  while (index < source.length) {
    if (source[index] === '[') {
      const close = source.indexOf(']', index + 1);
      if (close > index) {
        const word = source.slice(index + 1, close).trim();
        if (classifyTagWord(word).kind !== 'unknown') {
          // The tag's own leading space, if the model left one, goes with it — trimmed before the
          // offset is taken, so the offset lands where the words meet rather than one past it.
          if (text.endsWith(' ')) text = text.slice(0, -1);
          if (word) tags.push({ word, offset: text.length });
          index = close + 1;
          if (source[index] === ' ') index += 1;
          continue;
        }
      }
    }
    text += source[index];
    index += 1;
  }
  return { text, tags };
}

// The quotation marks this reading's own prompt shows the model around a marked run, taken off both
// ends together when a model reproduced them — the utterance itself never carries them (core's
// splitUtterances already took them off) — with every tag's offset moved down to match. The reader's
// own configured pairs are used when given (a line may be split on a pair other than the four default
// ones, and the model was shown the anchor with whichever pair actually wrapped it); the default pairs
// are the fallback, not the only ones.
function edgeQuotePairs(quotePairs) {
  const list = Array.isArray(quotePairs) && quotePairs.length ? quotePairs : DEFAULT_QUOTE_PAIRS;
  return list.map(pair => [pair[0], pair[1]]);
}

function stripEdgeQuote(text, tags, quotePairs) {
  for (const [open, close] of edgeQuotePairs(quotePairs)) {
    if (text.length < open.length + close.length || !text.startsWith(open) || !text.endsWith(close)) continue;
    const trimmed = text.slice(open.length, text.length - close.length);
    return { text: trimmed, tags: tags.map(tag => ({ ...tag, offset: Math.min(trimmed.length, Math.max(0, tag.offset - open.length)) })) };
  }
  return { text, tags };
}

// The same lead splitUtterances trimmed off `utterance.text` (EDGE_PUNCTUATION_RE) is trimmed off the
// reply's own line before the two are compared, so a sentence that legitimately opens on an ellipsis or
// a comma is not failed by the check for a lead that was never part of what the model was held to.
function trimEdgePunctuation(text) {
  const match = text.match(EDGE_PUNCTUATION_RE);
  const cut = match ? match[0].length : 0;
  return { text: text.slice(cut), cut };
}

/**
 * The character-for-character check: `stripped` (the reply's line with its tags and edge quotes
 * already taken off) against `source` (the sentence as the floor itself has it), each side's own
 * whitespace skipped rather than compared. A match returns a map from a position in `stripped` to the
 * same point in `source`, so a tag's offset converts straight across; a mismatch returns the position
 * of the first character that differs (or, when `stripped` ran out first, its own length), for the
 * one diagnostic line the caller logs about it.
 */
function alignToSource(stripped, source) {
  const isSpace = character => /\s/.test(character);
  const map = new Array(stripped.length + 1);
  let at = 0;
  for (let index = 0; index < stripped.length; index += 1) {
    const character = stripped[index];
    if (isSpace(character)) {
      map[index] = at;
      continue;
    }
    while (at < source.length && isSpace(source[at])) at += 1;
    if (source[at] !== character) return { map: null, at: index };
    map[index] = at;
    at += 1;
  }
  while (at < source.length && isSpace(source[at])) at += 1;
  if (at !== source.length) return { map: null, at: stripped.length };
  map[stripped.length] = at;
  return { map, at: -1 };
}

/** The shortest run of `text` starting at `start` that occurs nowhere else in `text`. */
function anchorForward(text, start) {
  if (start < 0 || start >= text.length) return '';
  for (let length = 1; start + length <= text.length; length += 1) {
    const candidate = text.slice(start, start + length);
    if (text.indexOf(candidate) === start) return candidate;
  }
  return text.slice(start);
}

/** The shortest run of `text` ending at `end` that occurs nowhere else in `text`. */
function anchorBackward(text, end) {
  if (end <= 0 || end > text.length) return '';
  for (let length = 1; end - length >= 0; length += 1) {
    const candidate = text.slice(end - length, end);
    if (text.indexOf(candidate) === end - length) return candidate;
  }
  return text.slice(0, end);
}

// ---------------------------------------------------------------------------------------------
// The edit panel shows a reader the word a pause or a stress sits on. anchorForward/anchorBackward
// above keep that word the shortest run that still finds it, which is what pauses.after and stress are
// stored as everywhere else — the same string a reader's own text search would use to locate it, kept
// exactly as it is. A reader looking at the panel is not searching, though: shown "近" by itself for a
// pause that trails a whole clause, they see one character. These two widen the anchor back out to the
// word or short phrase it sits in, purely for that display — the far edge, the one tag.offset itself
// pinned, is never moved; only the loose edge (the start for a pause, the end for a stress) moves out
// to the boundary of the word its own character sits in. Chinese and Japanese have no spaces between
// words, so that boundary comes from Intl.Segmenter's word segmentation rather than a character class —
// a run of CJK letters has no gaps for a naive class to stop at, and stopping instead at punctuation or
// a fixed number of characters (the old approach) just as often lands mid-word. Where Intl.Segmenter is
// missing entirely, the old letters/digits-run, capped a few characters out so a run with no punctuation
// in it does not widen without end, is what is left to fall back on. Nothing stored anywhere is this
// value; a floor edited since the analysis, or a result read back from before this existed, simply shows
// the anchor itself, exactly as the panel always has.
//
// Without a dictionary, Intl.Segmenter tells Japanese words apart mostly by script: 全部, こと, しく each
// come back whole, but a kanji stem gets cut away from the hiragana conjugation right after it (聞こえた
// -> 聞|こ|え|た), so wordBoundsAt alone hands back just the stem's own single character — and a longer
// conjugation (寝ていた -> 寝|てい|た, 食べた -> 食|べた) still leaves the stem cut off from a multi-character
// okurigana segment right next to it. extendOkurigana widens across any run of segments shaped like that:
// on the right, every further hiragana segment gets absorbed in turn (聞こえた, 許さない), stopping at a
// segment that is a known particle or conjunction (けど, から, って, なんか, …) rather than more of the
// same word, at anything that is not pure hiragana, or once OKURIGANA_MARGIN segments have been crossed;
// on the left, a segment already more than one character is only widened past when it hangs directly off
// a kanji segment (べた off 食, てい off 寝) — otherwise (こと after った) it is a whole word already and is
// left exactly where wordBoundsAt put it, same as before.
// ---------------------------------------------------------------------------------------------

const DISPLAY_WORD_RE = /[\p{L}\p{N}]/u;
const DISPLAY_MARGIN = 6;
const HAN_RUN_RE = /^\p{Script=Han}+$/u;
const HIRAGANA_RUN_RE = /^\p{Script=Hiragana}+$/u;
// A stem segment: pure kanji (寝) or kanji the segmenter kept together with its own kana (行き).
const STEM_START_RE = /^\p{Script=Han}/u;
const OKURIGANA_MARGIN = 4;
// Particles and conjunctions that close off a conjugated word instead of continuing it — encountering
// one of these while absorbing hiragana segments to the right of a kanji stem stops the widening just
// before it, the same way a segment that is not pure hiragana already stops it.
const OKURIGANA_STOP_WORDS = new Set([
  'は', 'が', 'を', 'に', 'で', 'と', 'も', 'の', 'から', 'けど', 'けれど', 'ので', 'のに',
  'し', 'な', 'ね', 'よ', 'わ', 'って', 'とか', 'だけ', 'より', 'まで', 'へ', 'や', 'なんか', 'など', 'でも', 'しか',
]);
// The first segment right after a kanji stem is its okurigana far more often than not, even when it
// looks like a particle (待|って, 話|し|て, 笑|わ|ない, 死|に|たい): only these, which never spell a
// conjugation, stop that first step.
// Auxiliary endings that only ever follow a conjugated stem (許さ|ない, 寝て|いる, 言わ|れる): a pause
// seed spelled like one is widened back across the hiragana before it to that stem, even when the stem's
// kanji is a segment or two away rather than right next to it.
const AUXILIARY_SEEDS = new Set(['ない', 'なかった', 'たい', 'たかった', 'いる', 'いた', 'れる', 'られる', 'せる', 'させる', 'ます', 'ました']);
const NEVER_OKURIGANA = new Set([
  'は', 'が', 'を', 'の', 'へ', 'や', 'も', 'から', 'けど', 'けれど', 'ので', 'のに', 'より', 'まで',
  'とか', 'だけ', 'など', 'しか', 'なんか',
]);
// When that first segment could just as well be a particle (家|に, 待|って, 変|な), only a conjugation
// ending right after it (死に|たい, 笑わ|ない, 話し|て) shows it was okurigana; anything else stops there.
const OKURIGANA_AUX_NEXT = new Set(['て', 'た', 'だ', 'ない', 'なかった', 'たい', 'たかった', 'ます', 'ました', 'ません', 'ず', 'ば']);
// Walking left from a pause, these end the word: a case particle or topic marker sits between a verb and
// whatever came before it (時間が|ない, 家に|いる, 本では|ない), never inside the verb itself.
const LEFT_STOP_WORDS = new Set([...NEVER_OKURIGANA, 'に', 'で', 'と', 'では', 'じゃ', 'には', 'とは', 'ね', 'よ', 'わ', 'な']);

// Word segmentation does not depend on locale for the languages this extension reads (Chinese, Japanese,
// English all come out the same either way), so one shared segmenter covers all of them. Older runtimes
// without Intl.Segmenter fall back to the character-class/margin widening below instead.
let wordSegmenter = null;
try {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') wordSegmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
} catch {
  wordSegmenter = null;
}

/** The [start, end) span of the word segment `at` falls inside, or null when Intl.Segmenter is
 * unavailable, `at` is out of range, or (should it ever happen) no segment covers it. */
function wordBoundsAt(source, at) {
  if (!wordSegmenter || at < 0 || at >= source.length) return null;
  try {
    for (const piece of wordSegmenter.segment(source)) {
      const end = piece.index + piece.segment.length;
      if (at < end) return at >= piece.index ? { start: piece.index, end } : null;
    }
  } catch {
    return null;
  }
  return null;
}

/** A stress's own end, pushed further right across an okurigana run the segmenter cut away from its
 * kanji stem — every further hiragana segment in a row, not just the first, stopping at whichever comes
 * first: a segment that is not pure hiragana, a known trailing particle or conjunction (OKURIGANA_STOP_WORDS,
 * け, から, って, なんか, …) that is a separate word rather than more of the same conjugation, or the margin. */
function extendOkuriganaRight(source, bounds) {
  if (bounds.end - bounds.start !== 1) return bounds.end;
  const seed = source[bounds.start];
  if (!HAN_RUN_RE.test(seed) && !HIRAGANA_RUN_RE.test(seed)) return bounds.end;
  const seedIsHan = HAN_RUN_RE.test(seed);
  let end = bounds.end;
  let particleShaped = false;
  for (let steps = 0; steps < OKURIGANA_MARGIN; steps += 1) {
    const next = wordBoundsAt(source, end);
    if (!next || next.start !== end) break;
    const chunk = source.slice(next.start, next.end);
    if (!HIRAGANA_RUN_RE.test(chunk)) break;
    if (steps === 0 && seedIsHan) {
      if (NEVER_OKURIGANA.has(chunk)) break;
      particleShaped = OKURIGANA_STOP_WORDS.has(chunk);
    } else if (particleShaped) {
      if (!OKURIGANA_AUX_NEXT.has(chunk)) break;
      particleShaped = false;
    } else if (OKURIGANA_STOP_WORDS.has(chunk)) {
      break;
    }
    end = next.end;
  }
  return end;
}

/** A pause's own start, pulled further left across the same kind of cut: any hiragana run right before
 * it, one segment at a time, then the one kanji segment it hangs off of — the word's own stem, not
 * whatever came before that. The seed itself must be hiragana, never a kanji: a kanji anchor already
 * standing alone is a complete Chinese word as often as it is a cut-off Japanese one (近, 喝), and
 * nothing here can tell those apart — only a hiragana seed is the okurigana's own signature.
 *
 * The segment the anchor itself sits in (the seed) is not always a single kana — Intl.Segmenter groups
 * a whole run of okurigana together as often as not (寝ていた -> 寝|てい|た, so the seed for a pause
 * anchored on いた is the two-character segment てい). A seed longer than one character only counts as
 * okurigana, rather than a whole word already sitting on its own (こと after 言った), when it hangs
 * directly off a kanji segment; the loop below then finds that same kanji segment on its first step.
 */
function extendOkuriganaLeft(source, bounds) {
  const seed = source.slice(bounds.start, bounds.end);
  if (!HIRAGANA_RUN_RE.test(seed)) return bounds.start;
  if (seed.length > 1) {
    const stem = wordBoundsAt(source, bounds.start - 1);
    const hangsOffKanji = stem && stem.end === bounds.start && HAN_RUN_RE.test(source.slice(stem.start, stem.end));
    if (!hangsOffKanji && !(AUXILIARY_SEEDS.has(seed) && reachesKanjiStem(source, bounds.start))) return bounds.start;
  }
  let start = bounds.start;
  for (let steps = 0; start > 0 && steps < OKURIGANA_MARGIN; steps += 1) {
    const prev = wordBoundsAt(source, start - 1);
    if (!prev || prev.end !== start) break;
    const chunk = source.slice(prev.start, prev.end);
    if (HIRAGANA_RUN_RE.test(chunk) && !LEFT_STOP_WORDS.has(chunk)) { start = prev.start; continue; }
    if (STEM_START_RE.test(chunk)) return prev.start;
    break;
  }
  return start;
}

/** Whether an unbroken run of hiragana segments to the left of `start` ends at a kanji segment within
 * OKURIGANA_MARGIN steps — the stem an auxiliary seed conjugates. */
function reachesKanjiStem(source, start) {
  let at = start;
  for (let steps = 0; at > 0 && steps < OKURIGANA_MARGIN; steps += 1) {
    const prev = wordBoundsAt(source, at - 1);
    if (!prev || prev.end !== at) return false;
    const chunk = source.slice(prev.start, prev.end);
    if (STEM_START_RE.test(chunk)) return true;
    if (!HIRAGANA_RUN_RE.test(chunk) || LEFT_STOP_WORDS.has(chunk)) return false;
    at = prev.start;
  }
  return false;
}

function widenAnchor(text, anchor, side) {
  const source = String(text ?? '');
  const word = String(anchor ?? '');
  if (!word) return word;
  const at = source.indexOf(word);
  if (at < 0) return word;
  if (side === 'left') {
    const bounds = wordBoundsAt(source, at);
    if (bounds) return source.slice(extendOkuriganaLeft(source, bounds), at + word.length);
    let start = at;
    for (let steps = 0; start > 0 && steps < DISPLAY_MARGIN && DISPLAY_WORD_RE.test(source[start - 1]); steps += 1) start -= 1;
    return source.slice(start, at + word.length);
  }
  const bounds = wordBoundsAt(source, at + word.length - 1);
  if (bounds) return source.slice(at, extendOkuriganaRight(source, bounds));
  let end = at + word.length;
  for (let steps = 0; end < source.length && steps < DISPLAY_MARGIN && DISPLAY_WORD_RE.test(source[end]); steps += 1) end += 1;
  return source.slice(at, end);
}

/** A pause's anchor, widened toward its own start — a pause lands right where the anchor already ends,
 * so that edge is kept exactly and only the word it opens on is guessed at. Panel display only. */
export function pauseDisplay(text, after) {
  return widenAnchor(text, after, 'left');
}

/** A stress anchor, widened toward its own end — stress lands right where the anchor already starts,
 * so that edge is kept exactly and only the rest of the word is guessed at. Panel display only. */
export function stressDisplay(text, word) {
  return widenAnchor(text, word, 'right');
}

/**
 * Tags, in the order they stood, turned into the same `voice` shape every other reading builds.
 *
 * Each tag's offset is a position in `sourceText` — 0 is the sentence's own opening, `sourceText.length`
 * its close. `full` is false only once this line failed the word-for-word check: then only the run of
 * tags standing at offset 0, the sentence's own opening, is read at all (the same little a bare mood
 * and tone the simple reading would have given it), and everything a tag further in would have placed
 * is left for `groundVoice` to never see. The caps (TAG_CAPS) hold whether or not the check passed:
 * three tags at the opening, two turns, two pauses, two stresses, one sound, no more — a model that
 * stacks more than this reading asked for is trimmed rather than obeyed.
 *
 * An anchor for a mid-sentence tag is not the word the model wrote beside it but the shortest run of
 * `sourceText` that starts or ends exactly at that tag's own offset and nowhere else in the sentence —
 * so the second `Alice` in a line that says her name twice is never the one a pause lands on because
 * the first one already claimed the same word.
 */
function classifyAndApply(voice, tags, sourceText, { full = true } = {}) {
  let startUsed = 0;
  let shiftsUsed = 0;
  let pausesUsed = 0;
  let stressUsed = 0;
  let soundsUsed = 0;
  const shifts = [];
  const pauses = [];
  const stress = [];
  const sounds = [];
  const length = sourceText.length;
  for (const tag of tags) {
    const atStart = tag.offset === 0;
    if (!full && !atStart) continue;
    if (atStart) {
      if (startUsed >= TAG_CAPS.start) continue;
      startUsed += 1;
    }
    const cls = classifyTagWord(tag.word);
    if (cls.kind === 'emotion') {
      if (atStart) {
        if (voice.emotion === undefined) voice.emotion = cls.word;
        else if (voice.secondary === undefined && cls.word !== voice.emotion) voice.secondary = cls.word;
      } else if (full && shiftsUsed < TAG_CAPS.shifts) {
        const anchor = anchorForward(sourceText, tag.offset);
        if (anchor) {
          shifts.push({ at: anchor, emotion: cls.word });
          shiftsUsed += 1;
        }
      }
    } else if (cls.kind === 'tone') {
      // A tone named mid-sentence has no slot of its own — one voice speaks the whole line — so only
      // the one at the opening is kept.
      if (atStart && voice.tone === undefined) voice.tone = cls.word;
    } else if (cls.kind === 'sound') {
      if (soundsUsed >= TAG_CAPS.sounds) continue;
      const at = atStart ? 'start' : tag.offset >= length ? 'end' : full ? 'after' : null;
      if (!at) continue;
      const entry = { at, tag: cls.word };
      if (at === 'after') {
        const anchor = anchorBackward(sourceText, tag.offset);
        if (!anchor) continue;
        entry.after = anchor;
      }
      sounds.push(entry);
      soundsUsed += 1;
    } else if (cls.kind === 'pause' && full && tag.offset > 0 && pausesUsed < TAG_CAPS.pauses) {
      const anchor = anchorBackward(sourceText, tag.offset);
      if (anchor) {
        pauses.push({ after: anchor, length: cls.length });
        pausesUsed += 1;
      }
    } else if (cls.kind === 'emphasis' && full && stressUsed < TAG_CAPS.stress) {
      const anchor = anchorForward(sourceText, tag.offset);
      if (anchor) {
        stress.push(anchor);
        stressUsed += 1;
      }
    }
    // Anything else — a word from neither vocabulary, three tags already spent at the opening — is a
    // tag this reading does not place, and it is simply not placed.
  }
  if (shifts.length) voice.shifts = shifts;
  // pausesAnchored/stressAnchored mark that these specific arrays are the shortest run that still finds
  // its word, not the word the model actually named — the one thing that tells the panel it may widen
  // them (see widenPauseStressSummary in index.js). A translation's mark or a correction sets pauses or
  // stress of its own without either flag, and mergeVoiceMaps (index.js) lays this voice's fields over
  // theirs one key at a time, so a field this line left untagged keeps whichever it had — anchored or
  // not, exactly as it already was.
  if (pauses.length) { voice.pauses = pauses; voice.pausesAnchored = true; }
  if (stress.length) { voice.stress = stress; voice.stressAnchored = true; }
  if (sounds.length) voice.sounds = sounds;
}

// The reply's own envelope ({"voices":[...]}), a bare array, or — while the reply is still streaming
// in — one closed object at a time, the same three shapes every reading's reply may come in.
function deepItemsOf(candidate) {
  if (Array.isArray(candidate)) return candidate;
  if (Array.isArray(candidate?.voices)) return candidate.voices;
  if (candidate && typeof candidate === 'object' && Object.hasOwn(candidate, 'id')) return [candidate];
  return [];
}

// Where the object opening at `start` closes, strings and escapes respected; -1 when it never does.
function objectEnd(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/**
 * The answers of a reply, in the order written, read straight off its text: every complete object in
 * its `voices` array (or in a bare array of answers), however many there are and wherever the text
 * stops, and whether the array was closed — a reply cut off at the provider's output limit is not. A
 * reply still arriving reads the same way, so the first answers are never lost to the last ones.
 */
function deepItemsFromText(raw) {
  const value = unwrapResponseContent(raw);
  if (typeof value !== 'string') return null;
  const text = value.replace(/<think(?:ing)?\b[^>]*>[\s\S]*?<\/think(?:ing)?>/gi, '');
  const key = text.search(/"voices"\s*:\s*\[/);
  let index = key >= 0 ? text.indexOf('[', key) : text.search(/\[\s*\{/);
  if (index < 0) return null;
  const items = [];
  for (index += 1; index < text.length;) {
    const character = text[index];
    if (character === ']') return { items, closed: true };
    if (character !== '{') {
      index += 1;
      continue;
    }
    const end = objectEnd(text, index);
    if (end < 0) break;
    try {
      items.push(JSON.parse(text.slice(index, end + 1)));
    } catch {
      // An answer that is not JSON is passed over; the ones around it still count.
    }
    index = end + 1;
  }
  return { items, closed: false };
}

// Every answer in the reply once, in the order it was written: the envelope comes first among the
// candidates, and the objects inside it, parsed again on their own, are the same answers a second time.
function deepItemsIn(candidates) {
  const items = [];
  const seen = new Set();
  for (const candidate of candidates) {
    for (const item of deepItemsOf(candidate)) {
      const signature = JSON.stringify(item);
      if (seen.has(signature)) continue;
      seen.add(signature);
      items.push(item);
    }
  }
  return items;
}

// A reply's `line` with its tags lifted out, a reproduced pair of quote marks taken off and the lead
// splitUtterances trims cut: the words alignToSource holds to a sentence, and where each tag stood in them.
function lineWords(rawLine, quotePairs) {
  const { text: untagged, tags: rawTags } = stripInlineTags(rawLine);
  const { text: unquoted, tags: edgeTags } = stripEdgeQuote(untagged, rawTags, quotePairs);
  const { text, cut } = trimEdgePunctuation(unquoted);
  return { text, tags: cut ? edgeTags.map(tag => ({ ...tag, offset: Math.max(0, tag.offset - cut) })) : edgeTags };
}

// ---------------------------------------------------------------------------------------------
// Reading the acoustic format.
//
// Each sentence comes back as a role, whether it is narration, a pace, a tension_level and — only
// where the sentence is performed rather than read as written — `content`: the words as they are to be
// said, with the ten tags inline. Content is the one place a model may touch the words, and only by
// adding: a stutter that repeats a character (我、我不是), the marks ！！ ~ …… and the interjections the
// rules name. acousticScript holds it to that: every character of the sentence must still be there, in
// order, and whatever was added must be one of those, or the line is read as written with only the tags
// it opened on. The result is `voice.script`, which the compile sends instead of the sentence; pace and
// tension_level go out as Fish's own speed and temperature.
// ---------------------------------------------------------------------------------------------

// Fish's documented spellings of the same sounds, and the names this reading used before, read as the
// ten tags. A word that is a tag in shape but none of these — [teasing], [cold] — is dropped where it stands.
const ACOUSTIC_ALIASES = Object.freeze({
  whispering: 'whisper',
  sighing: 'sigh',
  gasping: 'gasp',
  laughing: 'laughter',
  laugh: 'laughter',
  chuckling: 'snicker',
  chuckle: 'snicker',
  groaning: 'groan',
  'clearing throat': 'clear throat',
  break: 'pause',
  'short pause': 'pause',
  'long pause': 'pause',
  'long-break': 'pause',
});

function acousticTag(raw) {
  const word = cueLike(raw);
  if (!word) return '';
  if (ACOUSTIC_TAGS.includes(word)) return word;
  return Object.hasOwn(ACOUSTIC_ALIASES, word) ? ACOUSTIC_ALIASES[word] : '';
}

// The interjections a line may gain, in both languages a floor comes in, and the marks it may gain.
const ACOUSTIC_SOUND_CHARS = new Set([...'呜嗯唔啊哈呼', ...'うんあはふっぅぁウンアハフッゥァ']);
const isSpaceChar = character => /\s/u.test(character);
// Punctuation and symbols — an emoji, read as the one character it is — and the marks that only shape
// another character (a variation selector, a zero-width joiner): none is a word a line must keep.
const isMarkChar = character => /[\p{P}\p{S}\p{M}\p{Cf}ー]/u.test(character);
const isWordChar = character => /[\p{L}\p{N}]/u.test(character) && character !== 'ー';

/**
 * `content` as tags and characters, in order, a character being a code point. A bracket that is not
 * tag-shaped is part of the words, and so is a tag-shaped one that is none of the ten tags when the
 * sentence itself is written with it (按下 [OK] 键); any other one is dropped where it stands.
 */
function acousticTokens(content, source = '') {
  const text = String(content ?? '');
  const own = String(source ?? '');
  const tokens = [];
  let index = 0;
  while (index < text.length) {
    if (text[index] === '[') {
      const close = text.indexOf(']', index + 1);
      if (close > index && close - index <= 40 && cueLike(text.slice(index + 1, close))) {
        const word = acousticTag(text.slice(index + 1, close));
        if (word) {
          tokens.push({ tag: word });
          index = close + 1;
          continue;
        }
        if (!own.includes(text.slice(index, close + 1))) {
          index = close + 1;
          continue;
        }
      }
    }
    const character = String.fromCodePoint(text.codePointAt(index));
    tokens.push({ ch: character });
    index += character.length;
  }
  return tokens;
}

// The quotation marks a model reproduced around the whole line, taken off together, as the sentence
// itself never carries them.
function dropEdgeQuotes(tokens, quotePairs) {
  const chars = tokens.map((token, index) => (token.ch !== undefined && !isSpaceChar(token.ch) ? index : -1)).filter(index => index >= 0);
  if (chars.length < 2) return tokens;
  const first = chars[0];
  const last = chars[chars.length - 1];
  for (const [open, close] of edgeQuotePairs(quotePairs)) {
    if (open.length !== 1 || close.length !== 1) continue;
    if (tokens[first].ch === open && tokens[last].ch === close) return tokens.filter((_, index) => index !== first && index !== last);
  }
  return tokens;
}

/**
 * Whether `spoken` is `source` with only allowed additions, and where it first stops being so. Every
 * word character of the source must appear in order; the source's own punctuation may be dropped or
 * replaced (！ to ！！, a dash to a stutter); the additions may be marks, the interjections above, or a
 * stutter — a character repeated from the one just said or the one about to be said. Whitespace on
 * either side is not compared.
 */
function acousticAlign(spoken, source) {
  const said = Array.from(String(spoken ?? ''));
  const text = Array.from(String(source ?? ''));
  // Source character → the place in `spoken` it was said at (-1: dropped, or punctuation replaced).
  const placed = new Array(text.length).fill(-1);
  let at = 0;
  let previous = '';
  let added = 0;
  const nextWord = from => {
    for (let index = from; index < text.length; index += 1) if (isWordChar(text[index])) return text[index];
    return '';
  };
  for (let index = 0; index < said.length; index += 1) {
    const character = said[index];
    if (isSpaceChar(character)) continue;
    while (at < text.length && isSpaceChar(text[at])) at += 1;
    if (at < text.length && text[at] === character) {
      placed[at] = index;
      at += 1;
      if (isWordChar(character)) previous = character;
      continue;
    }
    if (isMarkChar(character)) continue;
    // The source's own punctuation dropped here, the next of its words said.
    let skip = at;
    while (skip < text.length && (isSpaceChar(text[skip]) || isMarkChar(text[skip]))) skip += 1;
    if (skip > at && text[skip] === character) {
      placed[skip] = index;
      at = skip + 1;
      previous = character;
      continue;
    }
    if (ACOUSTIC_SOUND_CHARS.has(character) || character === previous || character === nextWord(at)) {
      added += 1;
      continue;
    }
    return { ok: false, at: index, added, placed };
  }
  for (; at < text.length; at += 1) if (!isSpaceChar(text[at]) && !isMarkChar(text[at])) return { ok: false, at: said.length, added, placed };
  return { ok: true, at: -1, added, placed };
}

const QUESTION_MARKS = new Set(['？', '?']);

/**
 * A one-character question in the sentence (嗯？ 啊？ え？ — the character alone, no word around it)
 * keeps its question mark however the line is performed: a rising 嗯？ said as 嗯~ is another word
 * (the reader's 疑问尾词保护). Where the content dropped the mark or put ~ or …… in its place, a ？
 * follows what was said of that character — its stutters and its marks — before the next word.
 */
function keepBareQuestions(tokens, source, placed) {
  const text = Array.from(String(source ?? ''));
  const asked = [];
  for (let index = 0; index < text.length - 1; index += 1) {
    if (!isWordChar(text[index]) || !QUESTION_MARKS.has(text[index + 1])) continue;
    if (index > 0 && isWordChar(text[index - 1])) continue;
    asked.push(index);
  }
  if (!asked.length) return tokens;
  const said = tokens.map((token, index) => (token.ch !== undefined ? index : -1)).filter(index => index >= 0);
  const after = new Set();
  for (const index of asked) {
    const from = placed[index];
    if (from === undefined || from < 0) continue;
    let next = said.length;
    for (let later = index + 1; later < text.length; later += 1) {
      if (isWordChar(text[later]) && placed[later] >= 0) {
        next = placed[later];
        break;
      }
    }
    const between = said.slice(from + 1, next).map(at => tokens[at].ch);
    if (between.some(character => QUESTION_MARKS.has(character))) continue;
    let end = from;
    while (end + 1 < next) {
      const character = tokens[said[end + 1]].ch;
      if (character !== text[index] && !(isMarkChar(character) && !isSpaceChar(character))) break;
      end += 1;
    }
    after.add(said[end]);
  }
  if (!after.size) return tokens;
  return tokens.flatMap((token, index) => (after.has(index) ? [token, { ch: '？' }] : [token]));
}

// How much a line may gain: a few characters, more for a longer line.
const addedBudget = source => Math.max(4, Math.ceil([...String(source ?? '')].filter(isWordChar).length * 0.3));

/** Whether `content` performs `sourceText` — acousticScript's own check, without building the script. */
function acousticFits(content, sourceText, quotePairs) {
  const source = String(sourceText ?? '');
  const tokens = dropEdgeQuotes(acousticTokens(content, source), quotePairs);
  const check = acousticAlign(tokens.filter(token => token.ch !== undefined).map(token => token.ch).join(''), source);
  return check.ok && check.added <= addedBudget(source);
}

// Tags at one point, in the order the rules ask for: the filters first, then the sounds, two at most.
function settleGroup(group, { narrator, intimate, atStart, banned = [] }) {
  const seen = new Set();
  const kept = [];
  for (const tag of group) {
    if (seen.has(tag)) continue;
    seen.add(tag);
    // What the floor's tone never carries (ACOUSTIC_TONE_RULES).
    if (banned.includes(tag)) continue;
    // The narrator narrates even a moment of intimacy: no pant, no moan.
    if (narrator && (tag === 'panting' || tag === 'groan')) continue;
    // Without the reader's 亲密场景, a moan is never sent, whatever the model wrote.
    if (!intimate && tag === 'groan') continue;
    // A pause before anything has been said is no pause.
    if (atStart && tag === 'pause') continue;
    kept.push(tag);
  }
  const rank = tag => (ACOUSTIC_FILTERS.includes(tag) ? 0 : tag === 'pause' ? 2 : 1);
  return kept.sort((left, right) => rank(left) - rank(right)).slice(0, 2);
}

/**
 * `content` held to the sentence it performs. Returns the script Fish is to read — tags normalised,
 * two at most at any one point, filters first, one space after each group — or, when the words are not
 * the sentence's own plus allowed additions, the sentence as written with the tags it opened on, and
 * where the words first stopped matching. A content that changes nothing returns no script at all.
 */
export function acousticScript(content, sourceText, { quotePairs = null, narrator = false, intimate = false, tone = '' } = {}) {
  const banned = ACOUSTIC_TONE_RULES[tone]?.ban ?? [];
  const source = String(sourceText ?? '');
  const tokens = dropEdgeQuotes(acousticTokens(content, source), quotePairs);
  const spoken = tokens.filter(token => token.ch !== undefined).map(token => token.ch).join('');
  const check = acousticAlign(spoken, source);
  const withinBudget = check.added <= addedBudget(source);
  const performed = check.ok && withinBudget ? keepBareQuestions(tokens, source, check.placed) : tokens;
  const parts = [];
  let group = [];
  let saidAnything = false;
  const flush = () => {
    if (!group.length) return;
    const settled = settleGroup(group, { narrator, intimate, atStart: !saidAnything, banned });
    group = [];
    if (settled.length) parts.push({ tags: settled });
  };
  for (const token of performed) {
    if (token.tag === 'pause') {
      // A pause is a moment of its own: the tags after it start the next point, and it never counts
      // toward the two one point may carry.
      flush();
      group.push('pause');
      flush();
      continue;
    }
    if (token.tag) {
      group.push(token.tag);
      continue;
    }
    if (isSpaceChar(token.ch) && (group.length || !parts.length || parts[parts.length - 1].tags)) continue;
    flush();
    saidAnything = true;
    const last = parts[parts.length - 1];
    if (last && last.text !== undefined) last.text += token.ch;
    else parts.push({ text: token.ch });
  }
  flush();
  const render = list => list.map(part => (part.tags ? part.tags.map(tag => `[${tag}]`).join('') : part.text))
    .reduce((out, piece, index) => {
      if (!index) return piece;
      const tagged = list[index].tags || list[index - 1].tags;
      return tagged ? `${out.replace(/\s+$/u, '')} ${piece.replace(/^\s+/u, '')}` : `${out}${piece}`;
    }, '')
    .trim();
  if (!check.ok || !withinBudget) {
    const opening = parts[0]?.tags ? [parts[0]] : [];
    return { script: opening.length ? render([...opening, { text: source }]) : '', mismatch: true, at: check.ok ? Array.from(spoken).length : check.at };
  }
  const script = render(parts);
  const plain = !parts.some(part => part.tags) && script.replace(/\s/gu, '') === source.replace(/\s/gu, '');
  return { script: plain ? '' : script, mismatch: false, at: -1 };
}

const isAcousticItem = item => item && typeof item === 'object' && item.line === undefined
  && (['content', 'role', 'is_narrator', 'tension_level'].some(key => item[key] !== undefined)
    || (['pace', 'reason'].some(key => item[key] !== undefined) && item.speaker === undefined && item.emotion === undefined));

const NARRATOR_ROLE_RE = /^(?:旁白|旁白者|narrator|narration|ナレーション|ナレーター|地の文)$/i;

function readAcousticItem(item, utterance, { labels, voices, mismatches, quotePairs, intimate, tone }) {
  const id = utterance.id;
  const role = String(item?.role ?? item?.speaker ?? '').trim().slice(0, 60);
  // A sentence outside the quotes is the narrator's whoever the model names; inside them, the model says.
  const narrator = utterance.kind !== 'quoted' || item?.is_narrator === true || NARRATOR_ROLE_RE.test(role)
    || String(item?.type ?? '').trim().toLowerCase() === 'narration';
  const label = narrator ? { type: 'narration' } : { type: 'dialogue' };
  if (!narrator && role && !isPlaceholderSpeaker(role)) label.speaker = role;
  const lang = normalizeLanguageCode(item?.lang ?? item?.language);
  if (lang) label.lang = lang;
  labels.set(id, label);
  const voice = {};
  const pace = String(item?.pace ?? item?.speed ?? '').trim().toLowerCase();
  if (ACOUSTIC_PACES.includes(pace) && pace !== 'normal') voice.speed = pace;
  const tension = Number(item?.tension_level ?? item?.tension);
  // The narrator narrates even a climax: tension 3 at most (rule 17).
  if (Number.isFinite(tension) && tension >= 1) voice.tensionLevel = Math.min(narrator ? 3 : 5, Math.max(1, Math.round(tension)));
  const reason = String(item?.reason ?? '').trim();
  if (reason) voice.why = reason.slice(0, 24);
  if (typeof item?.content === 'string' && item.content.trim()) {
    const held = acousticScript(item.content, utterance.text, { quotePairs, narrator, intimate, tone });
    if (held.script) voice.script = held.script;
    if (held.mismatch) mismatches.push({ id, at: held.at, sentence: String(utterance.text ?? '') });
  }
  if (Object.keys(voice).length) voices.set(id, voice);
}

// The numbers a model has been seen to answer by instead of the ⟦编号⟧ it was given: the paragraph's own
// `line` from the request, or its own count of the sentences it was asked about.
const DEEP_NUMBERINGS = Object.freeze({
  line: (id, utterance) => utterance.lineId === id,
  count: (id, utterance, count) => count.get(utterance.id) === id,
});

/**
 * Which sentence each answer is about.
 *
 * An answer's `id` is the ⟦编号⟧ the request gave its sentence: every sentence in the acoustic format, the
 * dialogue alone in the format before it. A model may answer by another number — the paragraph's
 * `line`, or its own count — and read by that number an answer lands on a sentence it was not about. Its
 * own words say which sentence it meant: `content` in the acoustic format (acousticScript's check),
 * `line` in the format before (alignToSource). When two or more answers carry words and every one of
 * them names its sentence by the same other numbering, the whole reply is read by that numbering.
 * Otherwise each answer stays on its own number when that is a sentence it may answer for and its words,
 * if it has any, are that sentence's; an answer whose words are another such sentence's moves there. A
 * number that is no such sentence's and cannot be placed is left out; `dropped` names the ones that said
 * something about it.
 */
// The words of an answer or a sentence alone, with no tags and no marks.
const bareWords = text => Array.from(String(text ?? '').replace(/\[[^\]\n]{1,40}\]/g, '')).filter(isWordChar).join('');

function placeDeepItems(items, utterances, { quotePairs = null } = {}) {
  const quoted = utterances.filter(item => item.kind === 'quoted');
  const counts = {
    all: new Map(utterances.map((item, index) => [item.id, index + 1])),
    quoted: new Map(quoted.map((item, index) => [item.id, index + 1])),
  };
  const read = items.map(item => {
    const id = Number(item?.id);
    const acoustic = isAcousticItem(item);
    // The acoustic format answers for every sentence; the format before it, for the dialogue alone.
    const pool = acoustic ? utterances : quoted;
    const mine = pool.find(utterance => utterance.id === id) ?? null;
    const said = acoustic ? item?.content : item?.line;
    let fits = null;
    if (typeof said === 'string' && said.trim()) {
      if (acoustic) {
        fits = utterance => acousticFits(said, utterance.text, quotePairs);
      } else {
        const words = lineWords(said, quotePairs).text;
        fits = utterance => Boolean(alignToSource(words, String(utterance.text ?? '')).map);
      }
    }
    // Its own sentence is tried first. Words that fail it but are a shortened copy of it — part of it,
    // in order — are its own all the same, badly copied; only words that are not are looked for elsewhere.
    const shortened = Boolean(fits && mine) && (() => {
      const words = bareWords(said);
      return Boolean(words) && bareWords(mine.text).includes(words);
    })();
    const matches = !fits ? [] : mine && (fits(mine) || shortened) ? [mine] : pool.filter(fits);
    return { item, id, pool, mine, count: acoustic ? counts.all : counts.quoted, matches, own: Boolean(mine) && matches[0] === mine };
  });
  const evidence = read.filter(entry => entry.matches.length);
  const numbering = evidence.length >= 2 && evidence.some(entry => !entry.own)
    ? Object.keys(DEEP_NUMBERINGS).find(name => evidence.every(entry => entry.matches.some(utterance => DEEP_NUMBERINGS[name](entry.id, utterance, entry.count)))) ?? ''
    : '';
  const claimed = new Set();
  const placed = [];
  const dropped = [];
  let moved = 0;
  const place = (entry, target) => {
    if (!target) {
      const item = entry.item;
      const said = item?.speaker || item?.emotion || item?.line || item?.role || item?.content;
      if (said && Number.isFinite(entry.id)) dropped.push(entry.id);
      return;
    }
    if (target.id !== entry.id) moved += 1;
    claimed.add(target.id);
    placed.push({ item: entry.item, id: target.id });
  };
  if (numbering) {
    for (const entry of read) {
      const named = entry.pool.filter(utterance => DEEP_NUMBERINGS[numbering](entry.id, utterance, entry.count));
      place(entry, entry.matches.find(utterance => named.includes(utterance) && !claimed.has(utterance.id))
        ?? named.find(utterance => !claimed.has(utterance.id)) ?? null);
    }
    return { placed, numbering, moved, dropped };
  }
  // An answer on its own number first, so one that only found its way to a sentence by its words never
  // takes the place of the answer that was about it all along.
  const direct = read.filter(entry => entry.mine && (entry.own || !entry.matches.length));
  for (const entry of direct) place(entry, entry.mine);
  for (const entry of read) {
    if (direct.includes(entry)) continue;
    place(entry, entry.matches.find(utterance => !claimed.has(utterance.id)) ?? entry.mine);
  }
  return { placed, numbering, moved, dropped };
}

/**
 * The deep reply, read onto the utterances.
 *
 * Which sentence each answer is about is settled first (`placeDeepItems`): an answer numbered some
 * other way is moved to the sentence its own words name, or left out — never read onto another sentence
 * that happens to carry the same number. `numbering`, `moved` and `dropped` say what that took, for
 * the diagnostic the caller logs.
 *
 * `speaker`, `emotion` and `pace` are read exactly as the simple reading's own fields are: `emotion`
 * alone decides both the label's colour and, unless a tag in `line` overrules it, the voice Fish is
 * sent, so a reply that leaves `line` bare or unreadable still colours and voices the line as the
 * simple reading would have. `line` is held to the sentence it is supposed to be (`alignToSource`):
 * on a match every tag in it is placed by where it stood (`classifyAndApply`); on a mismatch only the
 * tags at the sentence's own opening are kept, the same little this line would have carried from the
 * simple reading, and the mismatch is reported in `mismatches` for the one diagnostic line the caller
 * logs about it — the sentence and the first character that did not agree.
 *
 * Nothing here calls `groundVoice`: every voice this reading returns still passes through it exactly
 * once, in buildSegments, the one place any reading's voice is held to the text.
 *
 * `quotePairs` is the reader's own configured set (falling back to the four default pairs), used to
 * take a reproduced quote mark off the edge of `line` the same way it was taken off `utterance.anchor`
 * in the first place. An item with no `line` but one of the old structured fields (`tone`, `pauses`,
 * `stress`, `sounds`, `shifts`, `intensity` and the rest) is a reply to a reader's own custom deep
 * prompt still written in the format this reading carried before v0.37 — its performance is read the
 * same way the simple reading already reads that shape (`normalizeVoice`) rather than silently dropped
 * because this reading now expects `line` instead.
 */
const LEGACY_VOICE_KEYS = Object.freeze([
  'tone', 'pauses', 'stress', 'sounds', 'shifts', 'shift', 'intensity', 'subtext', 'why', 'reason',
  'direction', 'instruction', 'speed', 'volume', 'breath', 'restraint', 'tension', 'rasp', 'hesitation',
]);

function levelOf(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(2, Math.max(0, Math.round(number))) : null;
}

/**
 * The floor's tone as an answer gave it — written before its voices, or after them — one of STORY_TONES,
 * or '' when it gave none (an answer to an older prompt, a reply cut off before it).
 */
function deepToneOf(raw) {
  const value = unwrapResponseContent(raw);
  if (value && typeof value === 'object' && !Array.isArray(value)) return storyToneOf(value.tone);
  if (typeof value !== 'string') return '';
  const text = value.replace(/<think(?:ing)?\b[^>]*>[\s\S]*?<\/think(?:ing)?>/gi, '');
  const voicesAt = text.search(/"voices"\s*:/);
  const head = (voicesAt >= 0 ? text.slice(0, voicesAt) : text).match(/"tone"\s*:\s*"([^"]{0,24})"/);
  if (head) return storyToneOf(head[1]);
  if (voicesAt < 0) return '';
  const tail = [...text.slice(voicesAt).matchAll(/\]\s*,\s*"tone"\s*:\s*"([^"]{0,24})"/g)].at(-1);
  return tail ? storyToneOf(tail[1]) : '';
}

export function parseDeepAnalysis(raw, utterances, { quotePairs = null, intimate = false, tone: knownTone = '' } = {}) {
  const list = Array.isArray(utterances) ? utterances : [];
  // A correction may leave the tone out: the floor's own stands.
  const tone = deepToneOf(raw) || storyToneOf(knownTone);
  const allowed = intimateAllowed(intimate, tone);
  const byId = new Map(list.map(item => [item.id, item]));
  const labels = new Map();
  const voices = new Map();
  const mismatches = [];
  // The answers straight off the text where it is text; any other shape of reply, as every reading reads it.
  const streamed = deepItemsFromText(raw);
  const found = streamed?.items.length ? null : parseJsonCandidates(raw);
  const items = streamed?.items.length ? streamed.items : deepItemsIn(found);
  const candidates = streamed?.items.length ? 1 : found.length;
  // A reply cut off before its answers closed: read what is there, but it is not the floor's whole reading.
  const complete = streamed?.items.length ? streamed.closed : found.some(candidate => deepItemsOf(candidate).length > 0);
  // Each answer on the sentence it is about (placeDeepItems), whatever number it came under.
  const { placed, numbering, moved, dropped } = placeDeepItems(items, list, { quotePairs });
  const format = placed.some(({ item }) => isAcousticItem(item)) ? 'acoustic' : 'legacy';
  for (const { item, id } of placed) {
    const utterance = byId.get(id);
    if (!utterance || labels.has(id)) continue;
    if (isAcousticItem(item)) {
      readAcousticItem(item, utterance, { labels, voices, mismatches, quotePairs, intimate: allowed, tone });
      continue;
    }
    if (String(item?.type ?? '').trim().toLowerCase() === 'narration') {
      labels.set(id, { type: 'narration' });
      continue;
    }
    const speaker = String(item?.speaker ?? '').trim().slice(0, 60);
    const paletteEmotion = normalizeEmotion(item?.emotion);
    const topEmotion = cueLike(item?.emotion);
    const rawLine = item?.line;
    const hasLine = typeof rawLine === 'string' && rawLine.trim();
    // pace is this reading's own field; a reply built for an old custom prompt (see LEGACY_VOICE_KEYS
    // below) may instead carry the simple reading's `speed`, read here as the same thing.
    const paceValue = VOICE_LEVELS.has(item?.pace) ? item.pace : VOICE_LEVELS.has(item?.speed) ? item.speed : null;
    const hasPace = paceValue !== null && paceValue !== 'normal';
    const hasLegacyVoice = !hasLine && LEGACY_VOICE_KEYS.some(key => item?.[key] !== undefined);
    // An id with nothing beside it — no speaker, no mood, no pace, no line — is not an answer: the
    // model did not address this sentence, and it is left exactly as unlabelled as one it never
    // named at all, rather than turned into a bare dialogue line by the mere fact of appearing.
    if (!(speaker && !isPlaceholderSpeaker(speaker)) && !paletteEmotion && !hasLine && !hasPace && !hasLegacyVoice) continue;
    const label = { type: 'dialogue' };
    if (speaker && !isPlaceholderSpeaker(speaker)) label.speaker = speaker;
    if (paletteEmotion) label.emotion = paletteEmotion;
    const lang = normalizeLanguageCode(item?.lang ?? item?.language);
    if (lang) label.lang = lang;
    labels.set(id, label);
    const voice = {};
    if (topEmotion && topEmotion !== 'neutral') voice.emotion = topEmotion;
    if (hasPace) voice.speed = paceValue;
    const intensity = levelOf(item?.intensity);
    if (intensity !== null) voice.intensity = intensity;
    if (hasLine) {
      const { text: words, tags } = lineWords(rawLine, quotePairs);
      const source = String(utterance.text ?? '');
      const { map, at } = alignToSource(words, source);
      if (map) {
        classifyAndApply(voice, tags.map(tag => ({ word: tag.word, offset: map[tag.offset] })), source, { full: true });
      } else {
        classifyAndApply(voice, tags, source, { full: false });
        mismatches.push({ id, at, sentence: source });
      }
    } else if (hasLegacyVoice) {
      const legacy = normalizeVoice(item, String(utterance.text ?? ''));
      if (legacy) Object.assign(voice, legacy);
    }
    if (Object.keys(voice).length) voices.set(id, voice);
  }
  return { labels, voices, candidates, mismatches, numbering, moved, dropped, complete, format, tone };
}
