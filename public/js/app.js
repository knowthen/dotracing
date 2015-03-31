(function(){

var app = angular.module('dotRacing', 
  ['ui.router', 'btford.socket-io', 'bindtable', 'auth0', 
  'angular-storage', 'angular-jwt', 'dotRacing.game']);

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
    .state('gameadd', {
      url: '/game/add',
      templateUrl: 'templates/gameadd.html',
      controller: 'GameAddCtrl'
    })
    .state('game', {
      url: '/game/:id',
      templateUrl: 'templates/game.html',
      controller: 'GameCtrl',
    })
    // TODO: add Leader Ctrl
    .state('leader', {
      url: '/leader',
      templateUrl: 'templates/leader.html',
      controller: 'LeaderCtrl'
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
  .controller('GameAddCtrl', gameAddCtrl)
  .controller('LoginCtrl', loginCtrl)
  .controller('LeaderCtrl', leaderCtrl);
  // TODO: add LeaderCtrl

app.run(function($rootScope, $state, auth, store, jwtHelper){
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
});

function homeCtrl($scope, bindTable, supported){
  var openGameTable, activeGameTable, gameTable;
  gameTable = bindTable('game', 20);
  gameTable.bind({status: 'new'});

  $scope.games = gameTable.rows;
  $scope.supported = supported;
  
  $scope.$on('$destroy', function(){
    gameTable.unBind();
  });
}

function loginCtrl($scope, store, auth) {
  $scope.login = function() {
    auth.signin({}, function(profile, token) {
      // Success callback
      store.set('profile', profile);
      store.set('token', token);
    }, function() {
      // Error callback
    });
  }
  $scope.logout = function() {
    auth.signout();
    store.remove('profile');
    store.remove('token');
  }
  $scope.auth = auth;
}

function gameCtrl ($scope, $stateParams, GameFactory, bindTable, socket) {
  var engine, width, height, options, game, gameTable, gameId;
  gameId = $stateParams.id;
  gameTable = bindTable('game');
  gameTable.bindRecord(gameId);

  $scope.game = game = gameTable.row;
  $scope.engine = engine = GameFactory.createGame(
    {
      socket: socket, 
      gameId: gameId
    });
  $scope.start = function(){
    $scope.started = true;
    engine.start();
  }
  engine.on('timer', function(startMessage){
    $scope.$apply(function(){
      $scope.startMessage = startMessage;
    });
  });
  engine.on('started', function(){
    $scope.$apply(function(){
      $scope.startMessage = 'GO!!!';
    });
  });
  socket.emit('join:room', $stateParams.id);
  socket.on('reconnect', function(){
    socket.emit('join:room', $stateParams.id);
  })

  $scope.$on('$destroy', function(){
    socket.emit('game:stopped', gameId);
    gameTable.unBind();
    engine.destroy();
  });
}

function gameAddCtrl ($scope, $state, auth, bindTable) {
  var gameTable = bindTable('game');
  $scope.add = function(game){
    gameTable.add(game)
      .then(function(result){
        $state.go('game', {id: result.id});
      }, function(err){
        console.log(err);
      });
  }
}
// TODO: add leaderCtrl function
function leaderCtrl($scope, bindTable){
  var scoreTable = bindTable('score', {sortBy: 'finish'});
  scoreTable.bind(null, 10);
  $scope.scores = scoreTable.rows;

  $scope.$on('$destroy', function(){
    scoreTable.unBind();
  });
}

})();