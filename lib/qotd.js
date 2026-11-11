// "Pregunta del día": one question a day for everyone. Answers stay hidden until you answer yourself.
export const QUESTIONS = [
  "¿Cuál fue tu primer videojuego?", "¿Qué comida de tu mamá (o abuela) extrañas más?", "¿Cuál es la peor película que has visto completa?",
  "Si pudieras vivir en cualquier ciudad del mundo, ¿cuál sería?", "¿Qué canción te pone de buenas al instante?", "¿Cuál es tu antojo de madrugada favorito?",
  "¿Qué juego te ha hecho enojar más en tu vida?", "¿Cuál era tu caricatura favorita de niño?", "¿Qué superpoder inútil te gustaría tener?",
  "¿Qué es lo más raro que has comido?", "¿Cuál fue el mejor concierto al que has ido (o al que quieres ir)?", "¿Qué hobby quieres aprender este año?",
  "¿Cuál es tu taco favorito y dónde lo comes?", "¿Qué juego crees que está sobrevalorado?", "¿Cuál es tu leyenda o historia de miedo favorita?",
  "¿Qué personaje de videojuego serías en la vida real?", "¿Cuál ha sido tu mejor viaje?", "¿Qué serie verías otra vez desde el principio?",
  "Si ganaras la lotería, ¿qué es lo primero que comprarías?", "¿Cuál fue tu primer trabajo?", "¿Qué te da más miedo de verdad?",
  "¿Qué apodo te pusieron de niño?", "¿Cuál es el mejor consejo que te han dado?", "¿Qué juego de mesa o cartas es tu favorito?",
  "¿Qué canción cantas en el karaoke?", "¿Cuál es tu bebida favorita?", "¿Qué habilidad tienes que nadie se imagina?",
  "¿Qué videojuego jugarías con todo el grupo si fuera gratis?", "¿Qué te hace sentir nostálgico?", "¿Cuál es tu película navideña favorita?",
  "¿Qué recuerdo de la escuela te da risa todavía?", "¿Cuál es el mejor regalo que has recibido?", "Si fueras un platillo mexicano, ¿cuál serías?",
  "¿Qué juego jugaste más horas en tu vida?", "¿Cuál es tu lugar favorito para estar tranquilo?", "¿Qué época de tu vida repetirías?",
  "¿Qué famoso te gustaría conocer?", "¿Cuál es tu mascota soñada?", "¿Qué te gustaría que el grupo hiciera junto en persona?",
  "¿Cuál es la app que más usas?", "¿Qué juego de tu infancia te gustaría que regresara?", "¿Qué comida no soportas?",
  "¿Cuál ha sido tu momento más épico jugando?", "¿Qué banda o artista escuchabas a los 15?", "¿Qué te gustaría aprender a cocinar?",
  "¿Qué es lo más valiente que has hecho?", "¿Cuál es tu día festivo favorito y por qué?", "¿Qué libro, cómic o manga recomiendas?",
  "¿Qué carro te gustaría tener?", "Si pudieras cambiar de carrera mañana, ¿a qué te dedicarías?", "¿Cuál es tu dulce mexicano favorito?",
  "¿Qué es algo que siempre has querido intentar?", "¿Cuál es tu frase o dicho favorito?", "¿Qué meme te sigue dando risa?",
  "¿Mar, montaña o ciudad?", "¿Qué juego de terror te dio más miedo?", "¿Qué es lo que más valoras de un amigo?",
  "¿Qué estarías haciendo ahorita si no estuvieras aquí?", "¿Cuál es tu recuerdo favorito con alguien del grupo?", "¿Qué te gustaría que te regalaran esta Navidad?",
];

function hash(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
export const questionFor = (day) => QUESTIONS[hash("qotd:" + day) % QUESTIONS.length];
