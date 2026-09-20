// Единый набор силуэтов для маркеров: человек — конкретный рейс или пилот,
// самолёт — среднее по типу ВС, вышка — среднее по аэропорту. Все фигуры
// нарисованы в квадрате 24×24, поэтому одинаково вставляются и в графики,
// и в вёрстку карточки рейса.
export const PLANE_PATH = "M12 1.6C13 1.6 13.9 3 13.9 4.6L13.9 8.2L22.4 13.3L22.4 15.4L13.9 12.9L13.9 17.6L16.5 19.5L16.5 21.1L12 19.9L7.5 21.1L7.5 19.5L10.1 17.6L10.1 12.9L1.6 15.4L1.6 13.3L10.1 8.2L10.1 4.6C10.1 3 11 1.6 12 1.6Z";
export const PILOT_HEAD_PATH = "M12 3.2C14.6 3.2 16.8 5.4 16.8 8.1C16.8 10.8 14.6 13 12 13C9.4 13 7.2 10.8 7.2 8.1C7.2 5.4 9.4 3.2 12 3.2Z";
export const PILOT_BODY_PATH = "M12 14.6C17 14.6 21.2 17.9 21.2 22H2.8C2.8 17.9 7 14.6 12 14.6Z";
// Вышка: широкий козырёк кабины и расширяющийся книзу ствол. Мелкие детали
// (антенна, окна, терминал) на 12–14 px превращаются в кашу, поэтому их здесь нет —
// полная версия иконки лежит в public/airport.png.
export const AIRPORT_CAB_PATH = "M2.6 3.6 H21.4 L18.6 9 H5.4 Z";
export const AIRPORT_TOWER_PATH = "M9.2 8.4 H14.8 L16.4 22.6 H7.6 Z";

export type MarkerKind = "pilot" | "plane" | "airport";

export const MARKER_PATHS: Record<MarkerKind, readonly string[]> = {
  pilot: [PILOT_HEAD_PATH, PILOT_BODY_PATH],
  plane: [PLANE_PATH],
  airport: [AIRPORT_CAB_PATH, AIRPORT_TOWER_PATH],
};

// halo — белый контур под заливкой: нужен там, где силуэт лежит прямо на полосе
// и иначе сливается с ней.
export function MarkerGlyph({ kind, size = 12, halo = false }: { kind: MarkerKind; size?: number; halo?: boolean }) {
  const paths = MARKER_PATHS[kind];
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      {halo && paths.map((path, index) => (
        <path key={`halo-${index}`} d={path} fill="none" stroke="#ffffff" strokeWidth="3" strokeLinejoin="round" />
      ))}
      {paths.map((path, index) => <path key={index} d={path} fill="currentColor" />)}
    </svg>
  );
}
