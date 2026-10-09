import { STORY_TONES, parseJsonCandidates, storyToneOf } from './core.js?v=0.45.0';

// ---------------------------------------------------------------------------------------------
// The scene of a floor, written down by the translation while it reads the floor anyway.
//
// Nothing in the extension shows it yet. It is kept for what is planned to stand on it — background
// music that follows the mood, an outline (and music) made from the story so far — and for any other
// extension that wants it now, through the public interface. One small object per floor: the mood from
// a fixed list, where and when, who is in it, and one sentence of what happens.
//
// The picture of the floor's moment (`visual`, in English for image models) belongs to the same object
// and stays off until pictures are drawn from it: off, the request does not ask for it and no scene
// keeps it. Each function below takes `picture` to read it the other way.
// ---------------------------------------------------------------------------------------------

// The same tones 分析模式 judges a floor by (core.js STORY_TONES).
export const SCENE_TONES = STORY_TONES;
export const SCENE_PICTURE = false;

// How long each field may be once read back: one that runs on is cut, never refused. A floor
// translated in several requests keeps every part's sentence, so the summary may hold a few.
const SCENE_LIMITS = Object.freeze({ place: 24, time: 24, cast: 80, summary: 320, visual: 400 });

/** What the translation request is told about the scene, as a system message of its own. */
export function composeSceneSection({ picture = SCENE_PICTURE } = {}) {
  const fields = picture
    ? '{"tone":"日常","place":"","time":"","cast":"","summary":"","visual":""}'
    : '{"tone":"日常","place":"","time":"","cast":"","summary":""}';
  return [
    '# 场景信息',
    `在 translations 之后再输出一个 scene 对象，概括这次请求里这段正文的场景，给${picture ? '背景音乐、大纲和配图' : '背景音乐和大纲'}用。scene 只写一个，不要放进 translations；每个字段都写字符串，不要写数组：`,
    `- tone：这段的氛围，从这几个词里选一个最贴切的：${SCENE_TONES.join('、')}。`,
    '- place：地点，12 个字以内；看不出就写空字符串。',
    '- time：时间（时段、季节或具体时刻），12 个字以内；看不出就写空字符串。',
    '- cast：出场的人，用 roster 或译文里的写法，顿号隔开。',
    '- summary：一句话梗概，60 个字以内，用译文的语言。',
    ...(picture ? ['- visual：用英文写这段最有画面感的一个瞬间：谁、在哪、在做什么、光线和氛围，40 个词以内，能直接交给文生图模型。'] : []),
    `格式：{"translations":[...],"scene":${fields}}`,
  ].join('\n');
}

// One field as text: a list the model wrote anyway is joined, whitespace runs collapse, and it is cut
// to its limit.
function sceneText(value, limit) {
  const text = Array.isArray(value)
    ? value.map(item => String(item ?? '').trim()).filter(Boolean).join('、')
    : String(value ?? '');
  return text.replace(/\s+/gu, ' ').trim().slice(0, limit);
}

/** A scene as it is kept: the known fields only, each a string, the mood one of SCENE_TONES or none. */
export function normalizeScene(value, { picture = SCENE_PICTURE } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const tone = storyToneOf(sceneText(value.tone, 20));
  const scene = {
    tone,
    place: sceneText(value.place, SCENE_LIMITS.place),
    time: sceneText(value.time, SCENE_LIMITS.time),
    cast: sceneText(value.cast, SCENE_LIMITS.cast),
    summary: sceneText(value.summary, SCENE_LIMITS.summary),
  };
  if (picture) scene.visual = sceneText(value.visual, SCENE_LIMITS.visual);
  return Object.values(scene).some(Boolean) ? scene : null;
}

/** The scene a translation reply carried, wherever in the reply the model put it; null without one. */
export function recoverScene(raw, options = {}) {
  for (const candidate of parseJsonCandidates(raw)) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const scene = normalizeScene(candidate.scene, options);
    if (scene) return scene;
  }
  return null;
}

/**
 * One floor's scene from the scenes of the requests it was translated in, `order` being where each
 * request's part of the floor starts. The mood, the place, the time and the picture are where the floor
 * ends up; who is in it is everyone any part named; what happens is every part's sentence in turn.
 */
export function mergeScenes(parts, options = {}) {
  const list = (Array.isArray(parts) ? parts : [])
    .filter(part => part?.scene)
    .sort((left, right) => (Number(left.order) || 0) - (Number(right.order) || 0))
    .map(part => part.scene);
  if (!list.length) return null;
  if (list.length === 1) return normalizeScene(list[0], options);
  const last = field => [...list].reverse().map(scene => scene[field]).find(Boolean) ?? '';
  const cast = [...new Set(list.flatMap(scene => String(scene.cast ?? '').split(/[、,，]\s*/u).map(name => name.trim()).filter(Boolean)))];
  const summary = list.map(scene => String(scene.summary ?? '').trim()).filter(Boolean)
    .reduce((joined, sentence) => (!joined ? sentence : /[。！？.!?…」』”]$/u.test(joined) ? `${joined}${sentence}` : `${joined}；${sentence}`), '');
  return normalizeScene({ tone: last('tone'), place: last('place'), time: last('time'), cast, summary, visual: last('visual') }, options);
}
