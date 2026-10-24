import { showScreen } from "../ui/screen.js";
import { campMenu } from "../ui/camp.js";

/** Shows a narration screen and waits for Enter ([P] opens the character sheet when there is a character). */
export async function narration(ctx, scene) {
  const render = () => showScreen(ctx, { title: scene.title, text: scene.text, art: scene.art });
  await render();
  await campMenu(ctx, render);
}
