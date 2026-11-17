// T6 (part): a GitHub repository typed into the page's Explode box before entering, the proposal card, Build, opened.
import { moves } from './lib.mjs';
const REPO = 'github.com/pmndrs/zustand';
export default {
  async before({ frame, sleep }) {
    const box = frame.getByRole('textbox', { name: 'EXPLODE ANYTHING' });
    await box.waitFor({ state: 'visible', timeout: 20_000 });
    await box.fill(REPO);
    await box.press('Enter');
    await sleep(800);
  },
  beats: [
    ['card', async (a) => {
      const m = moves(a);
      const t = await a.until((x) => !!x.card?.build, 'the proposal card', 60_000);
      await a.sleep(3500); // read the card
      await a.press(t.card.build);
      await a.sleep(1500);
    }],
    ['build', async (a) => {
      await a.until((x) => !/mr-headset|auth-service|iwsdk|jupiter|drivetrain/.test(x.step), 'the repository to open', 90_000);
      await a.sleep(3000);
    }],
    ['explore', async (a) => {
      await a.sleep(500);
      await a.pull();
      await a.sleep(4000);
    }],
  ],
};
