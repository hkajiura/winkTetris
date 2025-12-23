import vision from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";
const { FaceLandmarker, FilesetResolver } = vision;

const startBtn = document.getElementById("start");
const video = document.getElementById("cam");

// --- テトリス側の口（ここだけあなたの実装に差し替え） ---
const game = {
  rotate(dir) { console.log("rotate", dir); } // dir: -1 (left/CCW), +1 (right/CW)
};

// --- 推論関連 ---
let faceLandmarker;
let lastVideoTime = -1;

// wink判定の調整用（端末や照明で変わるのであとで微調整）
const ON = 0.65;     // 「閉じた」と判定する閾値
const OFF = 0.35;    // 「開いた」に戻ったと判定する閾値（ヒステリシス）
const COOLDOWN_MS = 250;

let cooldownUntil = 0;
// 「片目だけ閉じる→戻る」で1回発火させるための状態
let leftArmed = true;
let rightArmed = true;

// 任意：スコアのノイズを減らす（指数移動平均）
let emaL = 0, emaR = 0;
const EMA_ALPHA = 0.35;

function getScore(blendshapes, name) {
  // blendshapes: result.faceBlendshapes[0].categories
  const c = blendshapes?.find(x => x.categoryName === name);
  return c ? c.score : 0;
}

async function initLandmarker() {
  const fileset = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
  );

  faceLandmarker = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numFaces: 1,
    outputFaceBlendshapes: true,
  });
}

async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user" }, audio: false
  });
  video.srcObject = stream;
  await video.play();
}

function tick() {
  const now = performance.now();

  // 推論は video のフレームが進んだときだけ実行
  if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;

    const result = faceLandmarker.detectForVideo(video, now);
    const cats = result?.faceBlendshapes?.[0]?.categories;

    const rawL = getScore(cats, "eyeBlinkLeft");
    const rawR = getScore(cats, "eyeBlinkRight");

    // 平滑化
    emaL = EMA_ALPHA * rawL + (1 - EMA_ALPHA) * emaL;
    emaR = EMA_ALPHA * rawR + (1 - EMA_ALPHA) * emaR;

    // 片目だけ高い（両目同時は「普通の瞬き」として無視）
    const isLeftClosed  = emaL > ON && emaR < OFF;
    const isRightClosed = emaR > ON && emaL < OFF;

    if (now >= cooldownUntil) {
      // 「閉じる」瞬間だけ発火
      if (isLeftClosed && leftArmed) {
        leftArmed = false;
        cooldownUntil = now + COOLDOWN_MS;
        game.rotate(-1);
      }
      if (isRightClosed && rightArmed) {
        rightArmed = false;
        cooldownUntil = now + COOLDOWN_MS;
        game.rotate(+1);
      }
    }

    // 「開いた」に戻ったら再武装
    if (emaL < OFF) leftArmed = true;
    if (emaR < OFF) rightArmed = true;
  }

  requestAnimationFrame(tick);
}

startBtn.addEventListener("click", async () => {
  startBtn.disabled = true;
  await initLandmarker();
  await startCamera();
  requestAnimationFrame(tick);
});
