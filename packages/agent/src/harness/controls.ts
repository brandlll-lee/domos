import type { EngineControls, EngineSession } from "./types.ts";

export async function readControls(
  session: Pick<EngineSession, "controls" | "skills">,
): Promise<EngineControls> {
  const controls = (await session.controls?.()) ?? {
    options: [],
    commands: [],
    compact: false,
  };
  if (controls.skills !== undefined || controls.notices?.skills)
    return controls;
  try {
    const skills = await session.skills?.();
    return skills === undefined ? controls : { ...controls, skills };
  } catch (error) {
    return {
      ...controls,
      notices: {
        ...controls.notices,
        skills: `原生技能目录读取失败：${String(error)}`,
      },
    };
  }
}
