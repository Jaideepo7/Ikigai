import { api } from '../api';
import { refreshMe, toast } from '../state';
import { CHARACTERS } from '../game/Player';

const nav = (cta = '') => `<div class="landing-nav"><span class="logo">IKIGAI</span>${cta}</div>`;

export const landing = () => `
${nav('<a class="btn" data-go="login">GET STARTED</a>')}
<section class="grid-bg">
  <div class="hero">
    <div>
      <h1>Your garden only grows when <em>you</em> do.</h1>
      <p>Ikigai takes the tasks you keep putting off and turns them into XP, coins, and streaks. Finish the work, grow cool plants, and level up!</p>
      <div style="display:flex;gap:40px;margin-top:30px">
        <a class="btn rose" data-go="signup">Start Planting</a>
        <a class="btn" href="#loop" onclick="document.getElementById('loop').scrollIntoView({behavior:'smooth'});return false;">See The Loop</a>
      </div>
    </div>
    <div class="hero-img"><img src="/assets/ui/landing_hero.png" alt="A pixel-art greenhouse" /><span class="btn rose sm tag">+20 Points!</span></div>
  </div>
</section>
<section class="features" id="loop">
  <h2>Turn your to-dos into wins.</h2>
  <p>Each feature helps you grow, earn, and make progress - one task at a time.</p>
  <div class="feature-row">
    <div class="feature-cards">
      <div class="feature-card"><h3>PLANT A TASK</h3><p>Add the assignments you have been avoiding, set a difficulty and an estimate, and earn XP + coins when you finish.</p></div>
      <div class="feature-card"><h3>GROW YOUR GARDEN</h3><p>Spend coins on seeds and furniture, lay out your own fences, and watch plants mature on real timers. Miss your streak and they wither.</p></div>
      <div class="feature-card"><h3>VISIT FRIENDS</h3><p>Add friends with a code, walk around their garden in real time, and chat with speech bubbles.</p></div>
    </div>
    <img src="/assets/ui/spin_machine.png" alt="Daily spin log machine" style="width:100%;max-width:640px;justify-self:center" />
  </div>
</section>
<footer class="landing-footer grid-bg">
  <div><span class="logo">IKIGAI</span><small>a more mindful you,<br/>one task at a time</small></div>
  <a class="btn" data-go="signup">Join the Journey &rarr;</a>
</footer>`;

const authForm = (kind: 'login' | 'signup') => `
${nav()}
<div class="auth-wrap grid-bg"><form class="auth-card" data-auth="${kind}">
  <h1>${kind === 'login' ? 'Login' : 'Create an Account'}</h1>
  <label>Username</label><input name="username" required minlength="3" maxlength="20" pattern="[A-Za-z0-9_]+" placeholder="CoolCucumber27" autocomplete="username" />
  <label>Password</label><input name="password" type="password" required minlength="6" placeholder="Enter your password" autocomplete="${kind === 'login' ? 'current-password' : 'new-password'}" />
  ${kind === 'signup' ? '<label>Verify Password</label><input name="verify" type="password" required placeholder="Re-Enter Password" autocomplete="new-password" /><div id="admin-level" hidden><label>Admin test account · starting level (0-100)</label><input name="level" type="number" min="0" max="100" value="20" /></div>' : ''}
  <button class="btn-round" type="submit">${kind === 'login' ? 'Login' : 'Create Account'}</button>
  <div class="alt">${kind === 'login' ? 'Need an account? <a data-go="signup">Sign Up!</a>' : 'Have an account? <a data-go="login">Login</a>'}</div>
  <div class="err"></div>
</form></div>`;
export const loginScreen = () => authForm('login');
export const signupScreen = () => { queueMicrotask(wireSignup); return authForm('signup'); };
/** The admin test password reveals the level field (a hackathon convenience, not a security boundary). */
function wireSignup() {
  const pw = document.querySelector<HTMLInputElement>('input[name=password]'), box = document.getElementById('admin-level');
  if (!pw || !box) return;
  pw.addEventListener('input', () => { box.hidden = pw.value !== 'ADMIN_TEST'; });
}

export const selectScreen = () => {
  queueMicrotask(wireSelect);
  return `${nav()}
<div class="select-wrap grid-bg"><div class="bunting"></div>
  <h1>Select your gardener</h1>
  <div class="char-grid five"><div class="char-grid-inner">${Array.from({ length: CHARACTERS }, (_, i) => `<div class="char-tile" data-char="${i}"><img src="/assets/chars/portrait_${i}.png" alt="Gardener ${i + 1}" /></div>`).join('')}</div></div>
</div>`;
};
function wireSelect() {
  document.querySelectorAll<HTMLElement>('.char-tile').forEach((tile) => tile.addEventListener('click', () => {
    const i = Number(tile.dataset.char);
    const box = document.createElement('div');
    box.className = 'confirm';
    box.innerHTML = `<div class="confirm-card"><h2>Are you sure?</h2><p>You will not be able to go back!</p>
      <img src="/assets/chars/portrait_${i}.png" alt="" />
      <div class="confirm-actions"><button class="btn rose" id="c-no">No, Take me back</button><button class="btn sage" id="c-yes">Yes I'm sure!</button></div></div>`;
    document.body.appendChild(box);
    box.querySelector('#c-no')!.addEventListener('click', () => box.remove());
    box.querySelector('#c-yes')!.addEventListener('click', async () => {
      try { await api.post('/api/me/character', { character: i }); await refreshMe(); box.remove(); (await import('../main')).routes.game(); }
      catch (e) { toast((e as Error).message, 'err'); }
    });
  }));
}
