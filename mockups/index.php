<?php
/**
 * Quantex theme browser.
 *
 *   /                 gallery of every theme
 *   /{slug}           theme inside the viewer (device sizes, prev/next)
 *   /{slug}/raw       the bare theme page (what the viewer frames)
 *
 * Run:  php -S localhost:8090 index.php
 * Or drop the folder in XAMPP htdocs — .htaccess routes everything here.
 */

declare(strict_types=1);

const THEMES = [
    'aurora-glass' => [
        'name' => 'Aurora Glass',
        'tagline' => 'Frosted panels over a drifting neon aurora',
        'tone' => 'Dark · glow',
        'accent' => '#8b5cf6',
        'swatches' => ['#07060f', '#8b5cf6', '#22d3ee', '#2ef2a6', '#ff4d8d'],
    ],
    'swiss-editorial' => [
        'name' => 'Swiss Editorial',
        'tagline' => 'Paper, serif headlines and one orange signal',
        'tone' => 'Light · print',
        'accent' => '#ff4f00',
        'swatches' => ['#f3f0e8', '#111110', '#ff4f00', '#0f7b4a', '#d7263d'],
    ],
    'pro-terminal' => [
        'name' => 'Pro Terminal',
        'tagline' => 'Dense amber data desk with keyboard trading',
        'tone' => 'Dark · dense',
        'accent' => '#ffb000',
        'swatches' => ['#000000', '#ffb000', '#00e676', '#ff3b30', '#e6e6e6'],
    ],
    'soft-pastel-app' => [
        'name' => 'Soft Pastel App',
        'tagline' => 'Friendly, rounded and mobile-first',
        'tone' => 'Light · playful',
        'accent' => '#6c4dff',
        'swatches' => ['#f6f3ff', '#6c4dff', '#7ee0c3', '#ffb5a7', '#ffe8a3'],
    ],
    'neo-brutalist' => [
        'name' => 'Neo Brutalist',
        'tagline' => 'Hard shadows, loud type, zero apologies',
        'tone' => 'Light · bold',
        'accent' => '#c6ff3d',
        'swatches' => ['#fdf6e3', '#0a0a0a', '#c6ff3d', '#ff5ca8', '#ffd23d'],
    ],
];

// base path so links work at the web root or inside an htdocs subfolder
$base = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'])), '/');
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?? '/';
if ($base !== '' && str_starts_with($path, $base)) {
    $path = substr($path, strlen($base));
}
$path = trim($path, '/');

$h = static fn(string $s): string => htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
$url = static fn(string $p = ''): string => $base . '/' . ltrim($p, '/');

// old links like /themes/aurora-glass.html or /aurora-glass.html → clean URL
if (preg_match('~^(?:themes/)?(?:\d\d-)?([a-z-]+)\.html$~', $path, $m) && isset(THEMES[$m[1]])) {
    header('Location: ' . $url($m[1]), true, 301);
    exit;
}

if (preg_match('~^([a-z-]+)/raw$~', $path, $m) && isset(THEMES[$m[1]])) {
    header('Content-Type: text/html; charset=utf-8');
    readfile(__DIR__ . '/themes/' . $m[1] . '.html');
    exit;
}

$slugs = array_keys(THEMES);
$slug = $path === '' ? null : $path;

if ($slug !== null && !isset(THEMES[$slug])) {
    http_response_code(404);
    $slug = null;
    $notFound = true;
}

$theme = $slug ? THEMES[$slug] : null;
$index = $slug ? array_search($slug, $slugs, true) : 0;
$prev = $slugs[($index - 1 + count($slugs)) % count($slugs)];
$next = $slugs[($index + 1) % count($slugs)];
?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title><?= $theme ? $h($theme['name']) . ' — Quantex themes' : 'Quantex themes' ?></title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='%233d7bff'/><path d='M7 21l6-6 4 4 8-9' stroke='white' stroke-width='3' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
<style>
  :root {
    --bg: #0c0d11;
    --panel: #14161c;
    --panel-2: #1b1e26;
    --line: #262a35;
    --text: #eceef3;
    --muted: #8b90a0;
    --accent: <?= $h($theme['accent'] ?? '#3d7bff') ?>;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; }
  body { font-family: 'Inter', system-ui, sans-serif; background: var(--bg); color: var(--text); -webkit-font-smoothing: antialiased; }
  a { color: inherit; text-decoration: none; }
  button { font: inherit; color: inherit; }

  .bar { height: 60px; display: flex; align-items: center; gap: 12px; padding: 0 16px; border-bottom: 1px solid var(--line); background: var(--panel); position: sticky; top: 0; z-index: 10; }
  .brand { display: flex; align-items: center; gap: 10px; font-weight: 800; letter-spacing: -.02em; white-space: nowrap; }
  .brand i { width: 30px; height: 30px; border-radius: 9px; background: #3d7bff; display: grid; place-items: center; }
  .brand small { color: var(--muted); font-weight: 500; }
  .grow { flex: 1; min-width: 0; }
  .btn { display: inline-flex; align-items: center; gap: 8px; height: 38px; padding: 0 14px; border-radius: 10px; border: 1px solid var(--line); background: var(--panel-2); cursor: pointer; font-size: 14px; font-weight: 600; white-space: nowrap; transition: border-color .15s, background .15s; }
  .btn:hover { border-color: #3a4050; }
  .btn.icon { width: 38px; padding: 0; justify-content: center; }
  .btn.primary { background: var(--accent); border-color: transparent; color: #0c0d11; }
  kbd { font: 600 11px 'Inter'; color: var(--muted); border: 1px solid var(--line); border-bottom-width: 2px; border-radius: 5px; padding: 1px 5px; }

  /* gallery */
  .hero { max-width: 1280px; margin: 0 auto; padding: 48px 20px 12px; }
  .hero h1 { font-size: clamp(30px, 4.4vw, 52px); letter-spacing: -.035em; line-height: 1.05; }
  .hero p { color: var(--muted); margin-top: 12px; max-width: 620px; line-height: 1.6; }
  .grid { max-width: 1280px; margin: 0 auto; padding: 28px 20px 64px; display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 22px; }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: 18px; overflow: hidden; display: flex; flex-direction: column; transition: transform .2s, border-color .2s, box-shadow .2s; }
  .card:hover { transform: translateY(-4px); border-color: var(--c); box-shadow: 0 24px 50px -24px var(--c); }
  .thumb { position: relative; aspect-ratio: 16 / 10; overflow: hidden; background: var(--panel-2); border-bottom: 1px solid var(--line); }
  /* live page rendered at 1440px wide, scaled into the card */
  .thumb iframe { position: absolute; top: 0; left: 0; width: 1440px; height: 900px; border: 0; transform-origin: 0 0; pointer-events: none; }
  .thumb .shade { position: absolute; inset: 0; }
  .num { position: absolute; top: 12px; left: 12px; font-size: 12px; font-weight: 700; background: rgba(12,13,17,.75); backdrop-filter: blur(6px); padding: 4px 9px; border-radius: 999px; }
  .meta { padding: 16px 18px 18px; display: flex; flex-direction: column; gap: 10px; }
  .meta-top { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
  .meta h2 { font-size: 18px; letter-spacing: -.02em; }
  .tone { font-size: 11px; font-weight: 600; color: var(--muted); border: 1px solid var(--line); border-radius: 999px; padding: 3px 9px; white-space: nowrap; }
  .meta p { color: var(--muted); font-size: 14px; }
  .sw { display: flex; gap: 6px; }
  .sw span { width: 22px; height: 22px; border-radius: 6px; box-shadow: inset 0 0 0 1px rgba(255,255,255,.15); }
  .empty { max-width: 1280px; margin: 0 auto; padding: 0 20px; color: #ff8a8a; }

  /* viewer */
  .viewer { height: 100vh; display: flex; flex-direction: column; }
  .title { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .title b { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--accent); flex-shrink: 0; box-shadow: 0 0 12px var(--accent); }
  .picker { position: relative; }
  .menu { position: absolute; top: 46px; left: 0; width: 280px; background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 6px; box-shadow: 0 20px 50px rgba(0,0,0,.5); display: none; }
  .menu.open { display: block; }
  .menu a { display: flex; align-items: center; gap: 10px; padding: 10px; border-radius: 10px; font-size: 14px; }
  .menu a:hover, .menu a.on { background: var(--panel-2); }
  .menu a i { width: 12px; height: 12px; border-radius: 4px; flex-shrink: 0; }
  .menu a small { margin-left: auto; color: var(--muted); font-size: 11px; }
  .devices { display: flex; padding: 3px; border-radius: 11px; border: 1px solid var(--line); background: var(--panel-2); }
  .devices button { height: 30px; padding: 0 11px; border: 0; background: none; border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 600; color: var(--muted); }
  .devices button.on { background: var(--bg); color: var(--text); }
  .stage { flex: 1; min-height: 0; display: flex; justify-content: center; align-items: flex-start; overflow: auto; padding: 0; background: repeating-conic-gradient(#101218 0 25%, #0c0d11 0 50%) 0 0 / 24px 24px; }
  .stage.framed { padding: 24px; }
  .frame { width: 100%; height: 100%; border: 0; background: #fff; display: block; transition: width .3s ease; }
  .stage.framed .frame { border-radius: 16px; box-shadow: 0 0 0 1px var(--line), 0 30px 80px rgba(0,0,0,.6); height: calc(100% - 4px); }

  @media (max-width: 760px) {
    .brand small, .hide-sm { display: none; }
    .devices { display: none; }
    .grid { grid-template-columns: 1fr; }
    .hero { padding-top: 32px; }
  }
</style>
</head>
<body>
<?php if (!$theme): ?>
  <header class="bar">
    <a class="brand" href="<?= $h($url()) ?>"><i><svg width="16" height="16" viewBox="0 0 32 32"><path d="M5 22l7-7 5 5 10-11" stroke="white" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></i>Quantex <small>themes</small></a>
    <div class="grow"></div>
    <a class="btn primary" href="<?= $h($url($slugs[0])) ?>">Browse all →</a>
  </header>

  <section class="hero">
    <h1>Five directions for the<br>trading terminal.</h1>
    <p>Each theme is a working screen with a live chart, ticket and positions. Open one to try it at desktop, tablet or phone size, then use ← → to flip between them.</p>
  </section>
  <?php if (!empty($notFound)): ?><p class="empty">That theme doesn't exist, so here are all of them.</p><?php endif; ?>

  <main class="grid">
    <?php $n = 0; foreach (THEMES as $key => $t): $n++; ?>
      <a class="card" href="<?= $h($url($key)) ?>" style="--c: <?= $h($t['accent']) ?>">
        <div class="thumb">
          <iframe src="<?= $h($url($key . '/raw')) ?>" loading="lazy" tabindex="-1" title="<?= $h($t['name']) ?> preview" scrolling="no"></iframe>
          <div class="shade"></div>
          <span class="num"><?= sprintf('%02d', $n) ?></span>
        </div>
        <div class="meta">
          <div class="meta-top"><h2><?= $h($t['name']) ?></h2><span class="tone"><?= $h($t['tone']) ?></span></div>
          <p><?= $h($t['tagline']) ?></p>
          <div class="sw"><?php foreach ($t['swatches'] as $c): ?><span style="background: <?= $h($c) ?>"></span><?php endforeach; ?></div>
        </div>
      </a>
    <?php endforeach; ?>
  </main>

  <script>
    // scale each 1440px preview to its card width
    const fit = () => document.querySelectorAll('.thumb').forEach((box) => {
      box.querySelector('iframe').style.transform = `scale(${box.clientWidth / 1440})`;
    });
    fit();
    addEventListener('resize', fit);
  </script>
<?php else: ?>
  <div class="viewer">
    <header class="bar">
      <a class="btn icon" href="<?= $h($url()) ?>" title="All themes">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="6" height="6" rx="1.5"/><rect x="9" y="1" width="6" height="6" rx="1.5"/><rect x="1" y="9" width="6" height="6" rx="1.5"/><rect x="9" y="9" width="6" height="6" rx="1.5"/></svg>
      </a>

      <div class="picker">
        <button class="btn" id="pick" aria-haspopup="true" aria-expanded="false">
          <span class="title"><span class="dot"></span><b><?= $h($theme['name']) ?></b></span>
          <span class="hide-sm" style="color:var(--muted);font-weight:500"><?= $index + 1 ?>/<?= count($slugs) ?></span> ▾
        </button>
        <nav class="menu" id="menu">
          <?php foreach (THEMES as $key => $t): ?>
            <a href="<?= $h($url($key)) ?>" class="<?= $key === $slug ? 'on' : '' ?>"><i style="background: <?= $h($t['accent']) ?>"></i><?= $h($t['name']) ?><small><?= $h($t['tone']) ?></small></a>
          <?php endforeach; ?>
        </nav>
      </div>

      <div class="grow"></div>

      <div class="devices" id="devices">
        <button data-w="" class="on">Desktop</button>
        <button data-w="820">Tablet</button>
        <button data-w="390">Phone</button>
      </div>

      <a class="btn icon" href="<?= $h($url($prev)) ?>" title="Previous theme (←)">←</a>
      <a class="btn icon" href="<?= $h($url($next)) ?>" title="Next theme (→)">→</a>
      <a class="btn hide-sm" href="<?= $h($url($slug . '/raw')) ?>" target="_blank" rel="noopener">Full screen ↗</a>
    </header>

    <div class="stage" id="stage">
      <iframe class="frame" id="frame" src="<?= $h($url($slug . '/raw')) ?>" title="<?= $h($theme['name']) ?>"></iframe>
    </div>
  </div>

  <script>
    const stage = document.getElementById('stage');
    const frame = document.getElementById('frame');
    const menu = document.getElementById('menu');
    const pick = document.getElementById('pick');

    pick.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = menu.classList.toggle('open');
      pick.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', () => menu.classList.remove('open'));

    // device width is remembered across themes
    const setDevice = (w) => {
      document.querySelectorAll('#devices button').forEach((b) => b.classList.toggle('on', b.dataset.w === w));
      stage.classList.toggle('framed', w !== '');
      frame.style.width = w ? w + 'px' : '100%';
      try { localStorage.setItem('qx-theme-device', w); } catch {}
    };
    document.getElementById('devices').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b) setDevice(b.dataset.w);
    });
    try { const saved = localStorage.getItem('qx-theme-device'); if (saved !== null && innerWidth > 760) setDevice(saved); } catch {}

    addEventListener('keydown', (e) => {
      if (e.target.closest('input, textarea')) return;
      if (e.key === 'ArrowLeft') location.href = <?= json_encode($url($prev)) ?>;
      if (e.key === 'ArrowRight') location.href = <?= json_encode($url($next)) ?>;
      if (e.key === 'Escape') location.href = <?= json_encode($url()) ?>;
    });
  </script>
<?php endif; ?>
</body>
</html>
