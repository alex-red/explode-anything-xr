// T6 (part): the SDK's groups, then Jupiter from the nameplate.
import { moves } from './lib.mjs';
export default {
  beats: [
    ['sdk', async (a) => {
      const m = moves(a);
      let t = await a.targets();
      if (/repo-incident/.test(t.step)) {
        await m.btn('next', 1200); // finish the drill
        await m.btn('next', 0); // Real SDK
      }
      await m.stepIs(/iwsdk/, 'sdk', 15000);
      await a.sleep(2500);
      await m.btn('next', 900);
      await a.pull();
      await a.sleep(4000); // the groups a model chose
    }],
    ['jupiter', async (a) => {
      const m = moves(a);
      await a.sleep(400);
      await m.btn('nameplate', 1300);
      await m.row(/jupiter/i, 0);
      await m.stepIs(/jupiter/, 'jupiter', 15000);
      await a.sleep(2200);
      await a.pull();
      await a.sleep(3500);
    }],
  ],
};
