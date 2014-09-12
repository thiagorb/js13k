(function() {
    var STEPS_PER_SECOND = 180;

    // Creates a matrix with the given number of columns and rows, 
    // and initializes each element using a given function.
    function createMatrix(cols, rows, init) {
        var matrix = new Array(cols);
        for (var i = 0; i < cols; i++) {
            matrix[i] = new Array(rows);
            for (var j = 0; j < rows; j++) {
                matrix[i][j] = init(i, j);
            }
        }
        return matrix;
    }

    var canvas = document.getElementById("GameView");
    canvas.width = 800;
    canvas.height = 600;

    var Game = function() {
        var money = 200;
        var lives = 100;
        var frameController = new FrameController(canvas, STEPS_PER_SECOND, 60);
        var FieldSize = {
            width : 12,
            height : 9
        };
        var BLOCK_SIZE = 60;
        var CREEP_RADIUS = 0.09;

        // Represents the field where the game happens.
        var Field = function(width, height) {
            var cells = createMatrix(width, height, function(i, j) {
                if (j == 0 || j == height - 1)
                    return 1;
                if (i > 1 && i < width - 3)
                    return 0;
                if (j == (height / 2 | 0))
                    return 0;
                return 1;
            });

            // Implements the Dijkstra algorithm, used to find the shortest path
            // between any square in the field and the creeps goal.
            var dijkstra = function(source) {
                var unvisited = [];
                var unvisitedMap = createMatrix(width, height, function(i, j) {
                    unvisited.push({
                        x : i,
                        y : j
                    });
                    return true;
                });
                var dist = createMatrix(width, height, function() {
                    return undefined;
                });
                var previous = createMatrix(width, height, function() {
                    return undefined;
                });
                dist[source.x][source.y] = 0;
                while (unvisited.length) {
                    var minDist = undefined;
                    var minIndex = undefined;
                    for ( var i in unvisited) {
                        var v = unvisited[i];
                        if (dist[v.x][v.y] !== undefined
                                && (minDist === undefined || dist[v.x][v.y] < dist[minDist.x][minDist.y])) {
                            minDist = v;
                            minIndex = i;
                        }
                    }
                    if (!minDist)
                        break;
                    unvisited.splice(minIndex, 1);
                    unvisitedMap[minDist.x][minDist.y] = undefined;
                    var neighbors = [];
                    if (minDist.x > 0)
                        neighbors.push({
                            x : minDist.x - 1,
                            y : minDist.y
                        });

                    if (minDist.x < width - 1)
                        neighbors.push({
                            x : minDist.x + 1,
                            y : minDist.y
                        });

                    if (minDist.y > 0)
                        neighbors.push({
                            x : minDist.x,
                            y : minDist.y - 1
                        });

                    if (minDist.y < height - 1)
                        neighbors.push({
                            x : minDist.x,
                            y : minDist.y + 1
                        });

                    neighbors.forEach(function(v) {
                        if (!unvisitedMap[v.x][v.y])
                            return;
                        var alt = dist[minDist.x][minDist.y] + 1;
                        if (dist[v.x][v.y] === undefined
                                || alt < dist[v.x][v.y]) {
                            if (!cells[v.x][v.y])
                                dist[v.x][v.y] = alt;
                            previous[v.x][v.y] = minDist;
                        }
                    });
                }
                var optmized = createMatrix(width, height, function(i, j) {
                    var p = previous[i][j];
                    if (!p)
                        return;
                    var d = Vector.subFrom(p, {
                        x : i,
                        y : j
                    });
                    while (previous[p.x][p.y]
                            && Vector.equals(d, Vector.subFrom(
                                    previous[p.x][p.y], Vector.copy(p)))) {
                        p = previous[p.x][p.y];
                    }
                    return p;
                });
                return optmized;
            };

            // Renders the field in a background canvas and returns the resulting image.
            var renderBackground = function() {
                var image = document.createElement("canvas");
                image.width = BLOCK_SIZE * width;
                image.height = BLOCK_SIZE * height;
                var gc = image.getContext("2d");
                for (var i = 0; i < width; i++) {
                    for (var j = 0; j < height; j++) {
                        gc.fillStyle = [ "green", "brown", "gray" ][cells[i][j]];
                        gc.fillRect(i * BLOCK_SIZE, j * BLOCK_SIZE, BLOCK_SIZE,
                                BLOCK_SIZE);
                    }
                }
                return gc.getImageData(0, 0, image.width, image.height);
            };

            var backgroundImage = renderBackground();

            // Draws the pre-rendered field.
            this.render = function(gc) {
                gc.putImageData(backgroundImage, 0, 0);
            };

            this.origin = {
                x : 0,
                y : height / 2 | 0
            };

            this.goal = {
                x : width - 1,
                y : height / 2 | 0
            };

            // Checks if the position can be occupied, and if so mark it as occupied.
            this.putTower = function(x, y) {
                if (x <= 0 || y <= 0 || x >= width - 1 || y >= height - 1
                        || cells[x][y])
                    return false;
                cells[x][y] = 2;
                var previous = dijkstra(this.goal);
                if (previous[this.origin.x][this.origin.y]) {
                    this.previous = previous;
                    backgroundImage = renderBackground();
                    return true;
                } else {
                    cells[x][y] = 0;
                    return false;
                }
            };

            // Returns true if a creep should be able to walk in the given position.
            this.creepCanWalk = function(p) {
                if (p.x < 0 || p.y < 0 || p.x >= width || p.y >= height)
                    return 0;
                return !cells[p.x][p.y];
            };

            this.previous = dijkstra(this.goal);
        };

        var field = new Field(FieldSize.width, FieldSize.height);

        // This class is used to control (and render) all the creeps.
        var CreepsManager = function(origin) {
            var creeps = [];
            var summoning = false;
            var creepsToSummon = 30;
            var summonCounter = 0;
            var summonDelay = STEPS_PER_SECOND / 2;

            // Returns the first creep that is no more than 
            // the given distance away from the given point.
            this.getCreepAtDistance = function(point, distance) {
                var found = null;
                creeps.some(function(creep) {
                    var d = Vector.subFrom(point, Vector.copy(creep
                            .getPosition()));
                    if (Vector.norm2(d) <= distance * distance)
                        return found = creep;
                });
                return found;
            };

            // Checks if it is time to summon a creep, detect colisions between creeps,
            // and verifies if the creeps should be removed.
            this.step = function() {
                if (summoning) {
                    if (summonCounter) {
                        summonCounter--;
                    } else {
                        this.summon();
                        creepsToSummon--;
                        if (!creepsToSummon) {
                            summoning = false;
                        } else {
                            summonCounter = summonDelay;
                        }
                    }
                }
                ;
                creeps.forEach(function(creep) {
                    creep.decelerate();
                });
                creeps.forEach(function(creep) {
                    creep.step();
                });
                for (var i = 0; i < creeps.length; i++) {
                    var pi = creeps[i].getPosition();

                    for (var j = i + 1; j < creeps.length; j++) {
                        var pj = creeps[j].getPosition();
                        if (pi.x - CREEP_RADIUS * 2 > pj.x)
                            continue;
                        if (pi.y - CREEP_RADIUS * 2 > pj.y)
                            continue;
                        if (pj.x - CREEP_RADIUS * 2 > pi.x)
                            continue;
                        if (pj.y - CREEP_RADIUS * 2 > pi.y)
                            continue;
                        var dp = Vector.subFrom(pj, Vector.copy(pi));
                        if (Vector.norm2(dp) > CREEP_RADIUS * 2 * CREEP_RADIUS
                                * 2)
                            continue;
                        var si = creeps[i].getSpeed();
                        var sj = creeps[j].getSpeed();
                        var ds = Vector.subFrom(sj, Vector.copy(si));
                        if (Vector.scalarProduct(ds, dp) > 0)
                            continue;
                        var projj = Vector.project(sj, Vector.copy(dp));
                        var proji = Vector.project(si, dp);
                        Vector.subFrom(proji, si);
                        Vector.subFrom(projj, sj);
                        Vector.addTo(projj, si);
                        Vector.addTo(proji, sj);
                    }
                }
                for (var i = creeps.length - 1; i >= 0; i--) {
                    creeps[i].move();
                    if (creeps[i].foundGoal()) {
                        lives -= 1;
                        creeps.splice(i, 1);
                    } else if (creeps[i].isDead()) {
                        money += 5;
                        creeps.splice(i, 1);
                    }
                }
            };

            // Starts summoning the creeps.
            this.startSummoning = function() {
                summoning = true;
                creepsToSummon = 30;
            };

            // Summons one creep;
            this.summon = function() {
                var creep = new Creep(origin, {
                    x : 1 / STEPS_PER_SECOND,
                    y : (0.5 - Math.random() * 1) / STEPS_PER_SECOND
                });
                creeps.push(creep);
            };

            // Renders all the creeps at once.
            this.render = function(gc) {
                gc.save();
                gc.scale(BLOCK_SIZE, BLOCK_SIZE);
                gc.translate(0.5, 0.5);
                gc.fillStyle = "#0F0";
                creeps.forEach(function(creep) {
                    creep.render(gc);
                });
                gc.restore();
            };
        };

        // Represents one creep.
        var Creep = function(p, s) {
            var creepAcceleration = 0.01 / STEPS_PER_SECOND;
            var deceleration = creepAcceleration * 0.2;
            var maxSpeed = 0.8 / STEPS_PER_SECOND;
            var position = Vector.copy(p);
            var speed = s;
            var currentCell = Vector.round(Vector.copy(position));
            var life = 5;

            // Renders the creep.
            this.render = function(gc) {
                gc.beginPath();
                gc.arc(position.x, position.y, CREEP_RADIUS, 0, Math.PI * 2);
                gc.fill();
            };

            // Deacelerate the creep.
            this.decelerate = function() {
                var speedNorm = Vector.norm(speed);
                if (speedNorm < deceleration) {
                    speed = {
                        x : 0,
                        y : 0
                    };
                } else {
                    Vector.scale(speed, (speedNorm - deceleration) / speedNorm);
                }
            };

            // Finds the path to the goal, and tries to drive the creep.
            this.step = function() {
                if (currentCell.x < 0 || currentCell.x >= FieldSize.width || currentCell.y < 0 && currentCell.y >= FieldSize.height)
                    return;
                
                var next = field.previous[currentCell.x][currentCell.y];
                var speedNorm2 = Vector.norm2(speed);
                if (!next || speedNorm2 >= maxSpeed * maxSpeed)
                    return;
                
                var d = Vector.copy(next);
                Vector.subFrom(position, d);
                Vector.scale(d, creepAcceleration / Vector.norm(d));
                Vector.addTo(d, speed);
            };

            // Checks if the creep can move to the current direction (if not it bounces),
            // and then move.
            this.move = function() {
                var speedNorm = Vector.norm(speed);
                if (!speedNorm)
                    return;
                var nextCell = Vector.round(
                    Vector.addTo(
                        position, 
                        Vector.scale(Vector.copy(speed), (speedNorm + CREEP_RADIUS) / speedNorm)
                    )
                );
                var nextCellCopy = Vector.copy(nextCell);
                if (!Vector.equals(nextCell, currentCell) && !field.creepCanWalk(nextCell)) {
                    Vector.subFrom(currentCell, nextCell);
                    if (nextCell.x)
                        speed.x = -speed.x;
                    if (nextCell.y)
                        speed.y = -speed.y;
                }
                currentCell = nextCellCopy;
                Vector.addTo(speed, position);
            };

            // Returns true if the creep reached the goal.
            this.foundGoal = function() {
                return Vector.equals(currentCell, field.goal);
            };

            // Returns the creep position.
            this.getPosition = function() {
                return position;
            };

            // Returns the creep speed.
            this.getSpeed = function() {
                return speed;
            };

            // Reduces the creep life with the given damage.
            this.inflictDamage = function(damage) {
                life -= damage;
            };

            // Returns true if the creep is dead.
            this.isDead = function() {
                return life <= 0;
            };
        };

        // This class is used to control (and render) all the bullets.
        var BulletsManager = function() {
            var bullets = [];

            // Adds a new bullet.
            this.createBullet = function(position, speed, duration) {
                bullets.push({
                    position : position,
                    speed : speed,
                    duration : duration
                });
            };

            // Checks if the bullets hit a creep and move the bullets.
            this.step = function() {
                for (var i = bullets.length - 1; i >= 0; i--) {
                    var bullet = bullets[i];
                    var creep = creepsManager.getCreepAtDistance(
                            bullet.position, CREEP_RADIUS);
                    if (creep)
                        creep.inflictDamage(1);
                    if (!bullet.duration-- || creep)
                        bullets.splice(i, 1);
                    else
                        Vector.addTo(bullet.speed, bullet.position);
                }
            };

            // Renders all the bullets at once.
            this.render = function(gc) {
                gc.save();
                gc.scale(BLOCK_SIZE, BLOCK_SIZE);
                gc.translate(0.5, 0.5);
                gc.fillStyle = "white";
                bullets.forEach(function(bullet) {
                    gc.fillRect(bullet.position.x, bullet.position.y, 0.025,
                            0.025);
                });
                gc.restore();
            };
        };

        // Represents a tower.
        var Tower = function(position, createBullet) {
            var BULLET_RANGE = 3;
            var BULLET_SPEED = 7 / STEPS_PER_SECOND;
            var BULLET_DURATION = BULLET_RANGE / BULLET_SPEED | 0;
            var fireDelay = 0.2 * STEPS_PER_SECOND;
            var fireCounter = 0;

            // Tries to find a target, aim and shoot.
            this.step = function() {
                if (!fireCounter) {
                    var target = creepsManager.getCreepAtDistance(position,
                            BULLET_RANGE);
                    if (!target)
                        return;
                    var distance = Vector.subFrom(position, Vector.copy(target.getPosition()));
                    var offset = Vector.scale(Vector.copy(target.getSpeed()), Vector.norm(distance) / BULLET_SPEED);
                    Vector.addTo(offset, distance);
                    Vector.scale(distance, BULLET_SPEED / Vector.norm(distance));
                    createBullet(Vector.copy(position), distance,
                            BULLET_DURATION);
                    fireCounter = fireDelay;
                } else {
                    fireCounter--;
                }
            };
        };

        frameController.addRenderObject(field);

        var creepsManager = new CreepsManager(field.origin);
        frameController.addActionObject(creepsManager);
        frameController.addRenderObject(creepsManager);

        var bulletsManager = new BulletsManager();
        frameController.addActionObject(bulletsManager);
        frameController.addRenderObject(bulletsManager);

        frameController.addActionObject(new function() {
            this.step = function() {
                var click;
                while (click = frameController.readMouseClick()) {
                    if (money < 45)
                        continue;
                    var x = (click.x / BLOCK_SIZE) | 0;
                    var y = (click.y / BLOCK_SIZE) | 0;
                    if (field.putTower(x, y)) {
                        frameController.addActionObject(new Tower({
                            x : x,
                            y : y
                        }, bulletsManager.createBullet));
                        money -= 45;
                    }
                }
            };
        });

        frameController.addRenderObject(new function() {
            this.render = function(gc) {
                gc.save();
                gc.fillStyle = "white";
                gc.translate(600, 50);
                gc.scale(5, 5);
                gc.fillText(money, 0, 0);
                gc.fillText(lives, 0, 10);
                gc.restore();
            };
        });

        frameController.start();
        this.creepsManager = creepsManager;
    };
    
    var game;
    document.getElementById("btnSendCreeps").addEventListener("click", function () {
        game.creepsManager.startSummoning();
    });
    
    var btnNewGame = document.getElementById("btnNewGame");
    btnNewGame.addEventListener("click", function (e) {
        e.preventDefault();
        document.getElementById("GameMenu").style.opacity = 0;
        setTimeout(function () {
            document.getElementById("GameMenu").style.display = "none";
        }, 2000);
        game = new Game();
        return false;
    });
})();