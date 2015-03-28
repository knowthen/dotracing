(function(){
var app = angular.module('dotRacing', 
  ['ui.router', 'btford.socket-io', 'bindtable', 'auth0', 
  'angular-storage', 'angular-jwt', 'ngTouch']);

app.factory('socket', function(socketFactory){
  var options = {
    ioSocket: io.connect()
  }
  return socketFactory(options);
});

app.factory('bindTable', function(bindTableFactory, socket){
  return bindTableFactory({socket: socket});
});

app.factory('supported', function(){
  var supportedClient, host;
  supportedClient = ('ondevicemotion' in window) && isMobile.any;
  host = !isMobile.any;
  return {
    client: supportedClient,
    host: host
  }
});

app.config(function (authProvider) {
  authProvider.init({
    domain: 'knowthen.auth0.com',
    clientID: 'EfvfZDY2EGUrWoeTiarJ596BQGbn35qf'
    });
  })
  .run(function(auth) {
    auth.hookEvents();
  });

app.config(function($stateProvider, $locationProvider, $httpProvider) {
  $locationProvider.html5Mode({
    enabled: true,
    requireBase: false
  });
  $stateProvider
    .state('home', {
      url: '/',
      templateUrl: 'templates/home.html',
      controller: 'HomeCtrl'
    })
    .state('game', {
      url: '/game/:id',
      templateUrl: 'templates/game.html',
      controller: 'GameCtrl',
    })
    .state('otherwise', {
      url: '/',
      templateUrl: 'templates/home.html',
      controller: 'HomeCtrl'
    })
});

app
  .controller('HomeCtrl', homeCtrl)
  .controller('GameCtrl', gameCtrl)
  .controller('LoginCtrl', loginCtrl);
  

app.run(function($rootScope, $state, auth, store, jwtHelper, socket){
  socket.on('connect', function(){
    if(auth.isAuthenticated){
      var token = store.get('token');
      if(token){
        if (!jwtHelper.isTokenExpired(token)) {
          socket.emit('authenticate', {token: token, profile: store.get('profile')})
        }
      }
    }
  })
  $rootScope.$on('$locationChangeStart', function(){
    if (!auth.isAuthenticated) {
      var token = store.get('token');
      if (token) {
        if (!jwtHelper.isTokenExpired(token)) {
          auth.authenticate(store.get('profile'), token);
        } else {
          // Either show Login page or use the refresh token to get a new idToken
          // $location.path('/');
        }
      }
    }
  });

  $rootScope.$on('$stateChangeError',
    function(event, toState, toParams, fromState, fromParams, error) {
      if (error.status === 401) {
        $state.go('home');
      }
    });
})

function logout ($q, auth, store, socket){
  var deferred = $q.defer();
  auth.signout();
  store.remove('profile');
  store.remove('token');
  socket.emit('unauthenticate', {}, function(err){
    if(err){
      deferred.reject(err);
    }
    else{
      deferred.resolve();
    }
  });
  return deferred.promise;
}

function login ($q, auth, store, socket) {
  var deferred = $q.defer();
  if(auth.isAuthenticated){
    socket.emit('authenticate', {token: auth.idToken, profile: auth.profile}, function(err){
      if(err){
        deferred.reject(err);
      }
      else{
        deferred.resolve(auth.profile);
      }
    });
  }
  else{
    auth.signin({}, function(profile, token) {
      store.set('profile', profile);
      store.set('token', token);

      socket.emit('authenticate', {token: token, profile: profile}, function(err){
        if(err){
          deferred.reject(err);
        }
        else{
          deferred.resolve(profile);
        }
      });
      
    }, function(err) {
      deferred.reject(err);
    });
  }
  
  return deferred.promise;
}

function homeCtrl($scope, $state, $q, store, auth, socket, bindTable, supported){
  var openGameTable, activeGameTable, gameTable;
  gameTable = bindTable('game');
  gameTable.bind();
  $scope.games = gameTable.rows;
  $scope.supported = supported;
  $scope.$on('$destroy', function(){
    gameTable.unBind();
  });
  $scope.join = join($q, $state, auth, store, socket);
  
}

function joinGame ($q, socket, game) {
  var deferred = $q.defer();
  socket.emit('game:join', game.id, function(err, result){
    if(err){
      deferred.reject(err);
    }
    else{
      deferred.resolve(game);
    }
  })
  return deferred.promise;
}

function join ($q, $state, auth, store, socket) {
  return function (game){
    return login($q, auth, store, socket)
      .then(function(profile){
        return joinGame($q, socket, game);
      })
      .then(function(game){
        $state.go('game', {id: game.id})
      })
      .catch(function(err){
        alert(err);
        console.log(err);
      });
  }
}

function loginCtrl($scope, $q, store, auth, socket) {
  $scope.login = function(){
    login($q, auth, store, socket)
      .then();
  };
  $scope.logout = function(){
    logout($q, auth, store, socket)
      .then();
  }
  $scope.auth = auth;
}

function gameCtrl ($scope, $stateParams, $window, $state, socket, bindTable) {
  var lastForce, nextForce;
  var gameId = $stateParams.id;
  var limiter = new Bottleneck(1, 60, 1);

  gameTable = bindTable('game');
  gameTable.bindRecord(gameId);
  $scope.game = gameTable.row;
  socket.emit('player:ready', gameId);
  socket.on('reconnect', function(){
    socket.emit('player:ready', gameId);
  })
  socket.on('game:started', function(){
    // $window.addEventListener('devicemotion', devicemotionHandler);
    $window.ondevicemotion = devicemotionHandler;
  });
  socket.on('game:stopped', function(){
    // $window.removeEventListener('devicemotion', devicemotionHandler);
    $window.ondevicemotion = null;
    $state.go('home');

  });
  $scope.grow = function(){
    socket.emit('grow');
  }
  function sendForce (force, cb) {
    socket.emit('force', force);
    cb();
  }

  function devicemotionHandler (e) {
    var x, y, z, now;
    x = e.accelerationIncludingGravity.x;
    y = e.accelerationIncludingGravity.y;
    z = e.accelerationIncludingGravity.z;
    if(isMobile.android.device){
      x = -1 * x;
      y = -1 * y;
    }
    force = {
      x: x,
      y: y,
      z: z, 
      game: gameTable.row
    };
    // socket.emit('force', force);
    // now = new Date();
    // if(!lastForce){
    //   lastForce = now;
    // }
    // if(now.getTime() >= lastForce.getTime() + 60){
    //   // socket.emit('force', force);
    //   lastForce = now;
    // }

    limiter.submit(sendForce, force, null);
  }

  $scope.$on('$destroy', function(){
    socket.emit('leave:game', gameId);
    gameTable.unBind();
    // $window.removeEventListener('devicemotion', devicemotionHandler);
    $window.ondevicemotion = null;
  });
}
})();