const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = createServer(app);
const io = new Server(server);

// Servir les fichiers statiques
app.use(express.static('public'));

// Liste de mots pour le jeu
const words = [
    "Caca", "Pipi", "Prout", "Slip", "Chaussette", "Pizza", "Banane", "Glace", 
    "Bonbon", "Gateau", "Frites", "Pomme", "Chapeau", "Savon", "Doudou", 
    "Chat", "Chien", "Poisson", "Lapin", "Oiseau", "Cochon", "Vache", "Poule", 
    "Mouton", "Etoile", "Nuage", "Soleil", "Lune", "Fusee", "Robot", 
    "Chaussure", "Pyjama", "Chocolat", "Patate", "Fraise", "Cerise", "Citron", 
    "Carotte", "Oeuf", "Escargot", "Araignee", "Mouche", "Abeille", "Fourmi", 
    "Clown", "Pirate", "Monstre", "Fantome", "Dragon", "Sirene", "Boue", 
    "Baignoire", "Toilettes", "Brosse", "Sac", "Seau", "Pelle", "Nez", 
    "Oreille", "Doigt", "Main", "Pied", "Tong", "Ballon", "Bateau", "Voiture", 
    "Train", "Avion", "Cle", "Coeur", "Cadeau", "Crayon", "Livre", "Biberon", 
    "Pate", "Balle", "Chou", "Fromage", "Souris", "Tortue", "Lion", "Tigre", 
    "Zebre", "Singe", "Cheval", "Panda", "Girafe", "Pouce", "Neige", "Pluie", 
    "Fleur", "Arbre", "Feuille", "Gomme", "Tracteur", "Pantalon", "Tshirt", 
    "Pompier", "Roi", "Reine", "Enzo", "Clémence", "Lola", "Mathilde", "Erwan"
];

// État du jeu
const games = new Map();

// Fonction pour obtenir les informations des parties en cours
function getActiveGames() {
    const activeGames = [];
    games.forEach((game, id) => {
        activeGames.push({
            id: id,
            players: Array.from(game.players.values()).map(p => ({
                id: p.id,
                name: p.name,
                avatar: p.avatar,
                score: p.score
            })),
            inProgress: game.inProgress
        });
    });
    return activeGames;
}

// Envoyer la liste des parties à tous les clients
function broadcastGamesList() {
    io.emit('games_list', getActiveGames());
}

const ROUND_DURATION = 60; // secondes
const TRANSITION_DURATION = 10; // secondes

function getRandomWord() {
    return words[Math.floor(Math.random() * words.length)];
}

function calculatePoints(timeLeft) {
    if (timeLeft >= 50) return 60;
    if (timeLeft >= 40) return 50;
    if (timeLeft >= 30) return 40;
    if (timeLeft >= 20) return 30;
    if (timeLeft >= 10) return 20;
    if (timeLeft >= 1) return 50;
    return 0;
}

function startRoundTimer(gameId) {
    const game = games.get(gameId);
    if (!game) return;

    const roundDuration = 60; // 60 secondes par round
    game.roundEndTime = Date.now() + (roundDuration * 1000); // Stocker le timestamp de fin

    if (game.roundTimeout) {
        clearInterval(game.roundTimeout);
    }

    game.roundTimeout = setInterval(() => {
        const timeLeft = Math.ceil((game.roundEndTime - Date.now()) / 1000);
        
        if (timeLeft <= 0) {
            clearInterval(game.roundTimeout);
            io.to(gameId).emit('timer_update', { timeLeft: 0 });
            endRound(gameId);
            return;
        }

        io.to(gameId).emit('timer_update', { timeLeft });
    }, 1000);
}

function endRound(gameId) {
    const game = games.get(gameId);
    if (!game) return;

    game.currentRound++;
    console.log(`Round ${game.currentRound}/${game.maxRounds} terminé`); // Debug log

    // Nettoyer le timer
    if (game.roundTimeout) {
        clearInterval(game.roundTimeout);
        game.roundTimeout = null;
    }

    // Préparer la liste des joueurs qui ont trouvé
    const foundPlayers = Array.from(game.foundPlayers || []).map(playerId => {
        const player = game.players.get(playerId);
        return {
            id: playerId,
            name: player.name,
            avatar: player.avatar,
            score: player.score
        };
    });

    // Vérifier si c'est la fin de la partie
    if (game.currentRound >= game.maxRounds) {
        console.log('Fin de partie détectée'); // Debug log
        
        // Trier les joueurs par score
        const finalScores = Array.from(game.players.values())
            .map(p => ({
                id: p.id,
                name: p.name,
                avatar: p.avatar,
                score: p.score
            }))
            .sort((a, b) => b.score - a.score);

        console.log('Scores finaux:', finalScores); // Debug log

        // Envoyer les scores finaux
        io.to(gameId).emit('game_over', {
            scores: finalScores
        });

        // Attendre 10 secondes avant de redémarrer
        setTimeout(() => {
            console.log('Redémarrage de la partie'); // Debug log
            
            // Réinitialiser les scores
            game.players.forEach(player => {
                player.score = 0;
            });
            
            // Redémarrer la partie
            game.currentRound = 0;
            game.inProgress = false;
            startGame(gameId);
        }, 10000);

        return;
    }

    // Trouver le prochain dessinateur
    const players = Array.from(game.players.keys());
    const currentIndex = players.indexOf(game.currentDrawer);
    const nextIndex = (currentIndex + 1) % players.length;
    const nextDrawer = players[nextIndex];

    // Notifier la fin du round
    io.to(gameId).emit('round_end', {
        word: game.currentWord,
        nextDrawer: game.players.get(nextDrawer).name,
        foundPlayers: foundPlayers,
        currentRound: game.currentRound,
        maxRounds: game.maxRounds
    });

    // Attendre 5 secondes avant de commencer le prochain round
    setTimeout(() => {
        game.currentDrawer = nextDrawer;
        game.currentWord = getRandomWord();
        game.foundPlayers = new Set();
        
        // Notifier le début du nouveau round
        io.to(gameId).emit('new_turn', {
            drawer: game.currentDrawer
        });

        // Envoyer le nouveau mot au dessinateur
        io.to(game.currentDrawer).emit('word_to_draw', game.currentWord);

        // Redémarrer le timer
        startRoundTimer(gameId);

        // Nettoyer le canvas pour tout le monde
        io.to(gameId).emit('draw', { type: 'clear' });
    }, 5000);
}

io.on('connection', (socket) => {
    console.log('Nouveau joueur connecté:', socket.id);

    // Envoyer la liste initiale des parties au client qui se connecte
    socket.emit('games_list', getActiveGames());

    socket.on('create_game', (data) => {
        const gameId = generateGameId();
        games.set(gameId, {
            id: gameId,
            players: new Map(),
            currentDrawer: null,
            currentWord: null,
            inProgress: false,
            currentRound: 0,
            maxRounds: 3,
            foundPlayers: new Set()
        });

        socket.join(gameId);
        socket.gameId = gameId;

        // Ajouter le joueur à la partie
        games.get(gameId).players.set(socket.id, {
            id: socket.id,
            name: data.playerName,
            avatar: data.avatar,
            score: 0
        });

        broadcastGamesList();
        
        socket.emit('game_created', { gameId });
    });

    // Gestionnaire pour les événements de dessin
    socket.on('draw', (data) => {
        const game = games.get(data.gameId);
        if (!game || game.currentDrawer !== socket.id) return;
        
        // Retransmettre l'événement de dessin à tous les autres joueurs de la partie
        socket.to(data.gameId).emit('draw', data);
    });

    socket.on('join_game', (data) => {
        const game = games.get(data.gameId);
        if (!game) {
            socket.emit('error', 'Partie non trouvée');
            return;
        }
        
        console.log('Joueur', socket.id, 'rejoint la partie', data.gameId);
        
        socket.join(data.gameId);
        
        // Ajouter le joueur à la partie
        game.players.set(socket.id, {
            id: socket.id,
            name: data.playerName,
            avatar: data.avatar,
            score: 0
        });

        const playersList = Array.from(game.players.values());

        // Notifier le joueur qu'il a rejoint la partie
        socket.emit('game_joined', {
            players: playersList,
            isDrawer: game.currentDrawer === socket.id,
            currentWord: game.currentDrawer === socket.id ? game.currentWord : null
        });

        // Notifier les autres joueurs
        socket.to(data.gameId).emit('player_joined', {
            playerId: socket.id,
            name: data.playerName,
            avatar: data.avatar,
            score: 0
        });

        // Mettre à jour la liste des parties pour tout le monde
        io.emit('games_list', getActiveGames());

        // Si on a assez de joueurs et que la partie n'est pas commencée, la démarrer
        if (!game.inProgress && game.players.size >= 2) {
            startGame(data.gameId);
        }
    });

    socket.on('guess', (data) => {
        const game = games.get(data.gameId);
        if (!game || !game.currentWord || game.currentDrawer === socket.id) return;

        const guess = data.word.toLowerCase().trim();
        const word = game.currentWord.toLowerCase().trim();

        console.log('Joueur:', socket.id);
        console.log('Guess:', guess);
        console.log('Word:', word);
        console.log('Dessinateur:', game.currentDrawer);

        if (guess === word) {
            // Mettre à jour le score du joueur
            const player = game.players.get(socket.id);
            if (player) {
                // Calculer les points en fonction du temps restant
                const timeLeft = Math.ceil((game.roundEndTime - Date.now()) / 1000);
                const points = calculatePoints(timeLeft);
                player.score += points;
                
                // Ajouter le joueur à la liste des joueurs qui ont trouvé
                if (!game.foundPlayers) {
                    game.foundPlayers = new Set();
                }
                game.foundPlayers.add(socket.id);

                // Notifier tout le monde du succès
                io.to(data.gameId).emit('player_guessed', {
                    playerId: socket.id,
                    name: player.name,
                    avatar: player.avatar,
                    score: player.score,
                    points: points,
                    timeLeft: timeLeft
                });

                // Si tous les joueurs sauf le dessinateur ont trouvé, passer au tour suivant
                if (game.foundPlayers.size >= game.players.size - 1) {
                    // Donner des points au dessinateur
                    const drawer = game.players.get(game.currentDrawer);
                    if (drawer) {
                        drawer.score += 25; // Points fixes pour le dessinateur
                        io.to(data.gameId).emit('player_guessed', {
                            playerId: drawer.id,
                            name: drawer.name,
                            avatar: drawer.avatar,
                            score: drawer.score,
                            points: 25,
                            isDrawer: true
                        });
                    }
                    endRound(data.gameId);
                }
            }
        }
    });

    socket.on('disconnect', () => {
        games.forEach((game, gameId) => {
            if (game.players.has(socket.id)) {
                const player = game.players.get(socket.id);
                game.players.delete(socket.id);
                
                socket.to(gameId).emit('player_left', {
                    playerId: socket.id,
                    name: player.name,
                    avatar: player.avatar
                });

                // Si plus assez de joueurs, arrêter la partie
                if (game.players.size < 2) {
                    if (game.roundTimeout) {
                        clearInterval(game.roundTimeout);
                    }
                    game.inProgress = false;
                    game.currentDrawer = null;
                    game.currentWord = null;
                }

                // Si le dessinateur part, choisir un nouveau
                if (game.currentDrawer === socket.id) {
                    const remainingPlayers = Array.from(game.players.keys());
                    if (remainingPlayers.length > 0) {
                        game.currentDrawer = remainingPlayers[0];
                        game.currentWord = getRandomWord();
                        io.to(gameId).emit('new_turn', {
                            drawer: game.currentDrawer
                        });
                        io.to(game.currentDrawer).emit('word_to_draw', game.currentWord);
                    }
                }

                // Si plus de joueurs, supprimer la partie
                if (game.players.size === 0) {
                    games.delete(gameId);
                }

                // Mettre à jour la liste des parties
                io.emit('games_list', getActiveGames());
            }
        });
    });
});

function startGame(gameId) {
    const game = games.get(gameId);
    if (!game) return;

    game.inProgress = true;
    game.currentRound = 0;
    game.maxRounds = 10;
    
    // Choisir le premier dessinateur
    const players = Array.from(game.players.keys());
    game.currentDrawer = players[0];
    game.currentWord = getRandomWord();
    game.foundPlayers = new Set();

    // Notifier tout le monde
    io.to(gameId).emit('game_started');
    io.to(gameId).emit('new_turn', {
        drawer: game.currentDrawer
    });

    // Envoyer le mot au dessinateur
    io.to(game.currentDrawer).emit('word_to_draw', game.currentWord);

    // Démarrer le timer
    startRoundTimer(gameId);
}

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Serveur démarré sur le port ${PORT}`);
});

function generateGameId() {
    return Math.random().toString(36).substr(2, 9);
}
