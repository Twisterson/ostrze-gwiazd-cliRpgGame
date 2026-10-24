/** Thrown by a scene that needs a character when none has been created yet. */
export class MissingCharacterError extends Error {
  constructor(message = "scena wymaga postaci") {
    super(message);
    this.name = "MissingCharacterError";
  }
}

/** Thrown by a lethal lost fight (no `onDefeat`, not `nonLethal`): the app shows the defeat screen and loads the latest save. */
export class DefeatError extends Error {
  constructor(message = "gracz poległ w walce") {
    super(message);
    this.name = "DefeatError";
  }
}

/** Thrown by the camp menu ("Menu główne") to unwind the story back to the main menu. */
export class QuitToMenuError extends Error {
  constructor(message = "powrót do menu głównego") {
    super(message);
    this.name = "QuitToMenuError";
  }
}
