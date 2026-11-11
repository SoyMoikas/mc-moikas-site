// "Ruleta de castigos": spin a challenge for the game you're about to play. A friend confirms you did it → coins.
export const LEVELS = { 1: { name: "Fácil", coins: 15 }, 2: { name: "Difícil", coins: 30 }, 3: { name: "Brutal", coins: 50 } };
export const DAILY_DONE_CAP = 3;
export const DARE_HOURS = 24;

export const DARES = {
  "Apex Legends": [
    [1, "Gana una partida usando solo la primera arma que encuentres."], [1, "Juega una partida sin usar tu habilidad táctica."],
    [1, "Haz 3 knocks en una sola partida."], [2, "Juega con un legend que nunca usas y saca 2 kills."],
    [2, "Solo pistolas (P2020, RE-45, Wingman, Mozambique) toda la partida."], [2, "Cae en la zona más caliente del mapa y sobrevive 5 minutos."],
    [2, "Revive a tu equipo 3 veces en una partida."], [3, "Gana una partida (Champion) con el legend que te toque al azar."],
    [3, "Saca 1,500 de daño sin usar escudos morados ni dorados."], [3, "Juega una partida entera sin curarte con jeringas ni medkits."],
  ],
  "Minecraft (Ocaso)": [
    [1, "Pasa una noche entera sin antorchas."], [1, "Haz una ofrenda a un dios que no es tu favorito."],
    [1, "Construye una casa solo de tierra y duerme ahí una noche."], [2, "Sobrevive una noche sin armadura."],
    [2, "Consigue 64 de cualquier mineral sin usar el pico de hierro o mejor."], [2, "Encuentra un templo y sal con un códice."],
    [2, "Pasa 10 minutos con la cordura debajo de 40."], [3, "Sobrevive una Luna de Sangre fuera de tu base."],
    [3, "Mata a un guardián de templo solo con el machete."], [3, "Baja un nivel del Mictlán sin comida."],
  ],
  "Sons of the Forest": [
    [1, "Construye una base solo con troncos que tú cargues (sin ayuda)."], [1, "Juega un día entero del juego sin usar la pistola."],
    [2, "Sobrevive 2 noches sin construir paredes."], [2, "Explora una cueva solo con el encendedor como luz."],
    [2, "Caza solo con lanza durante una sesión."], [3, "Mata a un mutante grande solo con armas cuerpo a cuerpo."],
    [3, "Juega toda la sesión sin dormir en el juego."],
  ],
  "League of Legends": [
    [1, "Juega un campeón que nunca has usado."], [1, "No compres ningún objeto de control de visión en toda la partida (¡ni wards!)."],
    [2, "Gana una partida jugando un rol que no es el tuyo."], [2, "Llega a 10 minutos sin morir en línea."],
    [2, "Termina con más asistencias que todos tus compañeros."], [3, "Gana una partida con un build totalmente distinto al recomendado."],
    [3, "Termina la partida con KDA mayor a 5."],
  ],
  "Cualquier juego": [
    [1, "Habla solo con acento argentino toda la partida."], [1, "Cada vez que mueras, di \"fue lag\" con total seriedad."],
    [1, "Juega con la sensibilidad del mouse al doble."], [2, "Juega con el sonido del juego apagado."],
    [2, "Deja que tu equipo elija tu personaje / clase."], [2, "No puedes decir ninguna grosería en toda la partida."],
    [3, "Juega con el mouse en la mano contraria."], [3, "Gana sin usar el chat de voz (solo pings)."],
  ],
};
