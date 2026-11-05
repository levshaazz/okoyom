/** Типы кадра карты. Без three.js, чтобы остров мог подгрузить движок отдельно. */
export interface SceneMarker {
  id: string;
  x: number;
  y: number;
  primary: string;
  secondary: string | null;
  rumor: boolean;
}

export interface ScenePin {
  x: number;
  y: number;
  label: string;
  shared: boolean;
}

export interface SceneZone {
  x: number;
  y: number;
  radius: number;
  tone: 'low' | 'mid' | 'high';
}

export interface SceneRoute {
  points: { x: number; y: number }[];
}

export interface SceneLayers {
  places: boolean;
  threats: boolean;
  rumors: boolean;
  pins: boolean;
  routes: boolean;
  party: boolean;
  endonym: boolean;
  translation: boolean;
  /** Полог и кроны по маске леса. */
  forests: boolean;
  /** Дороги манифеста и маска, если она есть. */
  roads: boolean;
}
