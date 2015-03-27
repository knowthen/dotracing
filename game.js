'use strict';
let debug   = require('debug')('dotracing'),
    _       = require('lodash'),
    jwt     = require('jsonwebtoken'),
    config  = require('./config'),
    r       = require('./dash');

function setup (io) {

  io.on('connection', function(socket){
    debug('connection made');
    let tokenExpDate = null;
    let profile = null;
    let currentGame = null;
    
    function isAuthenticated () {
      return tokenExpDate && tokenExpDate >= new Date;
    }
    
    socket.on('authenticate', function(user, cb){
      try{
        debug('authenticate', user);
        let claim = jwt.verify(user.token, new Buffer(config.auth.secret, 'base64'));
        
        if(claim && claim.exp){
          tokenExpDate = new Date(claim.exp * 1000);
          profile = user.profile;
          profile.id = profile.user_id;
        }
        if(cb){
          cb(null, claim);
        }
        
      }
      catch(err){
        if(cb){
          cb(err);
        }
        
      }
    });
    
    socket.on('unauthenticate', function(data, cb){
      debug('unauthenticate');
      tokenExpDate = null;
      profile = null;
      if(cb){
        cb();
      }
    });

    socket.on('player:ready', function(gameId){
      r.table('game')
        .get(gameId)
        .then(function(game){
          game.players.forEach(function(player){
            if(profile && player.id === profile.id){
              currentGame = game;
              socket.join(gameId);
            }
          })
        })
    });

    function joinGame (game, profile, cb) {
      let joined = false;
      let players = game.players;
      let alreadyInGame = false;
      for (let i = 0; i < players.length; i++) {
        joined = players[i].id === profile.id;
        if(joined){
          break;
        }
      };
      
      if(joined){
        if(game.started){
          socket.emit('game:started');
        }
        if(cb){
          cb(null, game)
        }
      }
      else if (game.players.length < 4){
        r.table('game')
          .get(game.id)
          .update(function(game){
              return r.branch(game('players').count().lt(4),{
                players: game('players').append(profile)
              }, {});
            })
          .then(function(result){
            if(result.replaced > 0){
              currentGame = game;
              socket.to(game.id).emit('player:add', profile);
              if(cb){
                cb(null, game);
              }
            }
            else if (result.unchanged > 0){
              if(cb){
                cb(new Error('Game Already Full, Sorry!'));
              }
            }
          })
      }

      else{
        let err = new Error('Game Already Full, Sorry!');
        if(cb){
          cb(err);
        }
      }
    }

    socket.on('game:started', function(gameId, cb){
      r.table('game')
        .get(gameId)
        .update({
          started: true,
          status: 'running'
        })
        .then(function(){
          socket.to(gameId).emit('game:started');
        })
        .catch(function(err){
          if(cb){
            cb(err);
          }
          console.log(err);
        })
    });

    socket.on('game:stopped', function(gameId, cb){
      socket.to(gameId).emit('game:stopped');
      socket.leave(gameId);
      if(cb){
        cb(null, gameId);
      }
    });

    socket.on('game:join', function(id, cb){
      if(!isAuthenticated()){
        if(cb){
          cb(new Error('Must be logged in to join game!'))
        }
      }
      else{
        r.table('game')
          .get(id)
          .then(function(game){
            joinGame(game, profile, cb);
          })
          .catch(function(err){
            if(cb){
              cb(err);
            }
          });
      }
    });
    
    socket.on('game:findById', function(id, cb){
      r.table('game')
        .get(id)
        .run(cb);
    });

    socket.on('join:room', function(gameId){
      socket.join(gameId);
    });


    socket.on('leave:game', function(gameId){
      socket.leave(gameId);
    });
    

    socket.on('game:add', function(record, cb){
      record = _.pick(record, 'name', 'description');
      record.createdAt = new Date();
      record.status = 'new';
      record.players = [];
      r.table('game')
        .insert(record)
        .then(function(result){
          record.id = result.generated_keys[0];
          if(cb){
            cb(null, record);
          }
          
        })
        .catch(function(err){
          if(cb){
            cb(err);
          }
        })

    });

    

    socket.on('player:color', function(data, cb){

      r.table('game')
        .get(data.gameId)
        .update({
          players: r.row('players').map(function(player) {
              return r.branch(
                player('id').eq(data.playerId).default(false),
                player.merge({color: data.color}),
                player
              );
            })
          })
        .then(function(){
          if(cb){
            cb(null, data);
          }
        })
        .catch(function(err){
          if(cb){
            cb(err)
          }
        });
    });

    socket.on('game:changes:start', function(data, cb){
      debug('game:changes:start called');
      let limit, filter;
      limit = data.limit || 100; 
      filter = data.filter || {};
      r.table('game')
        .orderBy({index: r.desc('createdAt')})
        .filter(filter)
        .limit(limit)
        .changes()
        .then(function(cursor){
          if(cursor){
            cursor.each(function(err, record){
              if(err){
                console.log(err);
              }
              else{
                debug('emitting', record);
                socket.emit(data.changesEventName, record);
              }
            });
          }
          socket.on(data.stopChangesEventName, stopCursor);
          socket.on('disconnect', stopCursor);

          function stopCursor () {
            if(cursor){
              cursor.close();
              debug('closing cursor');
            }
            socket.removeListener(data.stopChangesEventName, stopCursor);
            socket.removeListener('disconnect', stopCursor);
          }
          if(cb){
            cb(null, data);
          }
        })
        .catch(function(err){
          if(cb){
            cb(err);
          }
          
        })
    });
    
    socket.on('game:record:changes:start', function(id){
      r.table('game')
        .get(id)
        .changes()
        .run({cursor: true}, handleChange);

      function handleChange(err, cursor){
        if(err){
          console.log(err); 
        }
        else{
          if(cursor){
            cursor.each(function(err, record){
              if(err){
                console.log(err);
              }
              else{
                socket.emit('game:record:changes:' + id, record);
              }
            });
          }

        }
        socket.on('game:record:changes:stop:' + id, stopCursor);
        socket.on('disconnect', stopCursor);

        function stopCursor () {
          if(cursor){
            cursor.close();
            console.log('closing cursor ' + id);
          }
          socket.removeListener('game:record:changes:stop:' + id, stopCursor);
          socket.removeListener('disconnect', stopCursor);
        }

      }
    });
    socket.on('force', function(force){
      if(profile && currentGame){
        force.playerId = profile.id;
        if(currentGame){
          socket.to(currentGame.id).emit('force', force);
        }
      }
    });

    socket.on('grow', function(cb){
      if(profile && currentGame){
        if(currentGame){
          socket.to(currentGame.id).emit('grow', profile.id);
        }
      }
    });

    socket.on('lap', function(info, cb){
      r.table('game')
        .get(info.gameId)
        .update({
          players: r.row('players').map(function(player) {
              return r.branch(
                player('id').eq(info.playerId).default(false),
                player.merge({
                  lap: info.lap,
                  lapTime: info.lapTime
                }),
                player
              );
            })
          })
        .then(function(){
          if(cb){
            cb(null, info);
          }
          
        })
        .catch(function(err){
          if(cb){
            cb(err)
          }
        });

    });

    socket.on('finish', function(info, cb){
      var finishPlayer, score;
      debug('finished', info, profile);
      // r.table('game')
      //   .get(info.gameId)
      //   .then(function(game){
      //     game.players.forEach(function(player){
      //       if(player.id === info.playerId){
      //         finishPlayer = player;
      //         player.place = info.place;
      //         player.raceTime = info.raceTime;
      //         player.lapTime = info.lapTime;
      //       }
      //     });
      //     r.table('game')
      //       .get(info.gameId)
      //       .update(game)
      //       .then();

      r.table('game')
        .get(info.gameId)
        .update({
          players: r.row('players').map(function(player) {
              return r.branch(
                player('id').eq(info.playerId).default(false),
                player.merge({
                  place: info.place,
                  lapTime: info.lapTime,
                  raceTime: info.raceTime
                }),
                player
              );
            })
          })
        .then(function(){
          if(cb){
            cb(null, info);
          }
        })
        .catch(function(err){
          if(cb){
            cb(err)
          }
        });
      r.table('game')
        .get(info.gameId)
        .then(function(game){
          score = {
            game: {
              id: game.id,
              name: game.name
            },
            player: {
              id: info.playerId,
              nickname: profile.nickname,
              picture: profile.picture
            },
            finish: info.raceTime,
            place: info.place
          };
          r.table('score')
            .insert(score)
            .then();
        });
      
    });
    
    socket.on('score:changes:start', function(data, cb){
      let limit, filter;
      limit = data.limit || 100;
      filter = data.filter || {};
      r.table('score')
        .orderBy({index: 'finish'})
        .filter(filter)
        .limit(limit)
        .changes()
        .then(function(cursor){
          cursor.each(function(err, record){
            if(err){
              console.log(err);
            }
            socket.emit(data.changesEventName, record);
          });
          socket.on(data.stopChangesEventName, stopCursor);
          socket.on('disconnect', stopCursor);
          function stopCursor () {
            
            if(cursor){
              cursor.close();
            }
            socket.removeListener(data.stopChangesEventName, stopCursor);
            socket.removeListener('disconnect', stopCursor);
          }
          if(cb){
            cb(null, data);
          }
        })
        .catch(function(err){
          if(cb){
            cb(err);
          }
          console.log(err);
        });
    });

  });

}

module.exports = {
  setup: setup
};