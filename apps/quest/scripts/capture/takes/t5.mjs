// T5: the incident drill, with the learner's two questions spoken to the Ask orb.
import { moves } from './lib.mjs';
export default {
  voices: ['video/takes/voice/why.wav', 'video/takes/voice/plug.wav'],
  beats: [
    ['drill', async (a) => {
      const m = moves(a);
      await a.sleep(800);
      await m.btn('next', 0); // Incident drill
      await m.stepIs(/repo-incident:0:/, 'drill', 8000);
      await a.sleep(2800); // it opens broken
      await m.btn('next', 900);
      await a.pull();
      await a.sleep(1500);
      await m.node('fn:src/http/middleware.ts#parsejsonbody', 2500); // the first part that never gets the request
    }],
    ['ask', async (a) => {
      const m = moves(a);
      await a.sleep(600);
      const n = await m.eventCount();
      await m.ask();
      await m.waitEvent(/"origin":"tutor"/, n, 30_000);
      await a.sleep(5500); // the answer and its evidence on screen
    }],
    ['act', async (a) => {
      const m = moves(a);
      await a.sleep(400);
      await m.btn('next', 1200);
      const n = await m.eventCount();
      await m.ask();
      await m.waitEvent(/"type":"plug"/, n, 30_000);
      await a.sleep(4500); // Resolved
    }],
  ],
};
