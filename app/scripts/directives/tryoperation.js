'use strict';

PhonicsApp.controller('TryOperation', function ($scope, formdataFilter,
  AuthManager) {
  var specs = $scope.$parent.specs;
  var rawModel = '';
  var NONE_SECURITY = 'None';

  $scope.httpProtorcol = 'HTTP/1.1';
  $scope.generateUrl = generateUrl;
  $scope.makeCall = makeCall;
  $scope.xhrInProgress = false;

  if (Array.isArray($scope.getParameters())) {
    $scope.parameters = $scope.getParameters().map(makeParam);
  } else {
    $scope.parameters = [];
  }

  function makeParam(parameter) {
    var param = _.extend(parameter, {
      schema: schemaForParameter(parameter),
      form: formForParameter(parameter),
      model: {}
    });

    if (parameter.schema && parameter.schema.type === 'array') {
      param.model[parameter.name] = [];
    }

    return param;
  }

  function schemaForParameter(parameter) {
    var schema;

    // For rendering form we need "type" key
    if (parameter && parameter.schema) {
      if (!parameter.schema.type) {
        parameter.schema.type = 'object';
      }

      // Work around angular-schema-form issue handling array types
      if (parameter.schema.type === 'array') {
        schema = {
          type: 'object',
          properties: {}
        };

        schema.properties[parameter.name] = parameter.schema;
        schema.properties[parameter.name].type = 'array';

        // TODO: Is this always true?
        schema.properties[parameter.name].items.type = 'object';

        return schema;
      }
      return parameter.schema;
    }

    // If parameter do not have a schema use parameter itself as schema
    schema = {type: 'object', properties: {}};
    schema.properties[parameter.name] = _.pick(parameter,
      'type', 'description', 'required', 'format');
    return schema;
  }

  function formForParameter(parameter) {
    // Work around angular-schema-form issue handling array types
    if (parameter.schema && parameter.schema.type === 'array') {
      var form = [{key: parameter.name}];

      form[0].items = [parameter.name + '[]'];
      return form;
    }
    return ['*'];
  }

  function filterParamsFor(type) {
    return function filterParams(result, param) {
      if (param.in === type && param.model[param.name] &&
        param['default'] !== param.model[param.name]) {
        result[param.name] = param.model[param.name];
      }
      return result;
    };
  }

  function getScheme() {
    if ($scope.scheme) {
      return $scope.scheme;
    }
    return $scope.walkToProperty('schemes')[0];
  }

  function generateUrl() {
    var scheme = getScheme();
    var host = specs.host || window.location.host;
    var basePath = specs.basePath || '';
    var pathTemplate = _.template($scope.path.pathName);
    var pathParams = $scope.parameters.reduce(filterParamsFor('path'), {});
    var queryParams = $scope.parameters.reduce(filterParamsFor('query'), {});
    var queryParamsStr = $.param(queryParams);
    var pathStr = '';

    try {
      pathStr = pathTemplate(pathParams);
    } catch (e) {}

    return scheme + '://' + host + basePath + pathStr +
      (queryParamsStr ? '?' + queryParamsStr : '');
  }

  $scope.hasBodyParam = function () {
    return $scope.parameters.some(function (param) {
      return param.in === 'body';
    });
  };

  $scope.rawChanged = function (change) {
    var editor = change[1];
    rawModel = editor.getValue();
  };

  function getBodyModel() {
    return $scope.parameters.map(function (param) {
      if (param.in === 'body') {
        return modelOfParameter(param);
      }
    })[0];
  }

  $scope.getRequestBody = function () {

    if ($scope.inputMode === 'raw') {
      return rawModel;
    }

    var bodyModel = getBodyModel();

    if (!$scope.contentType) {
      return '';
    } else if ($scope.contentType.indexOf('form-data') > -1) {
      return formdataFilter(bodyModel);
    } else if ($scope.contentType.indexOf('application/json') > -1) {
      return JSON.stringify(bodyModel, null, 2);
    } else if ($scope.contentType.indexOf('x-www-form-urlencoded') > -1) {
      return $.param(bodyModel);
    }

    return '';
  };

  function getHeaderParams() {
    var parameters = $scope.parameters.filter(function (param) {
      return param.in === 'header';
    }).reduce(function (obj, param) {
      var model = modelOfParameter(param)[param.name];
      if (model) {
        obj[param.name] = model;
      }
      return obj;
    }, {});

    // If Auth is Basic Auth extend the parameters with Authentication parameter
    var auth = AuthManager.getAuth($scope.selectedSecurity);
    if (auth && auth.type === 'basic') {
      parameters = _.extend(parameters, {
        Authorization: 'Basic ' + auth.options.base64
      });
    }

    return parameters;
  }

  $scope.getHeaders = function () {
    var headerParams = getHeaderParams();
    var content = $scope.getRequestBody();

    headerParams = _.extend(headerParams, {
      Host: $scope.specs.host || window.location.host,
      Accept: $scope.accepts || '*/*',
      'Accept-Encoding': 'gzip,deflate,sdch', //TODO: where this is coming from?
      'Accept-Language': 'en-US,en;q=0.8,fa;q=0.6,sv;q=0.4', // TODO: wut?
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      Origin: window.location.origin,
      Referer: window.location.origin + window.location.pathname,
      'User-Agent': window.navigator.userAgent
    });

    if (content) {
      headerParams['Content-Length'] = content.length;
      headerParams['Content-Type'] = $scope.contentType;
    }

    return headerParams;
  };

  /*
   * Because some properties are cascading this walks up the tree to get them
  */
  $scope.walkToProperty = function (propertyName) {
    var defaultProperties = {
      consumes: ['*/*'],
      schemes: ['http']
    };

    if (Array.isArray($scope.operation[propertyName])) {
      return $scope.operation[propertyName];
    } else if (Array.isArray($scope.specs[propertyName])) {
      return $scope.specs[propertyName];
    }

    // By default return the default property if it exists
    if (defaultProperties[propertyName]) {
      return defaultProperties[propertyName];
    }
    return undefined;
  };

  /*
   * Get model of a parameter
  */
  function modelOfParameter(param) {
    // part of horrible hack for json schema form
    if (Array.isArray(param.model[param.name])) {
      return param.model[param.name];
    }
    return param.model;
  }

  function makeCall() {
    $scope.xhrInProgress = true;
    $scope.error = null;
    var omitHeaders = ['Host', 'Accept-Encoding', 'Connection', 'Origin',
      'Referer', 'User-Agent', 'Cache-Control', 'Content-Length'];

    $.ajax({
      url: $scope.generateUrl(),
      type: $scope.operation.operationName,
      headers: _.omit($scope.getHeaders(), omitHeaders),
      data: $scope.getRequestBody(),
      contentType: $scope.contentType
    })

    .fail(function (jqXHR, textStatus, errorThrown) {
      $scope.xhrInProgress = false;
      $scope.textStatus = textStatus;
      $scope.error = errorThrown;
      $scope.xhr = jqXHR;

      $scope.$digest();
    })

    .done(function (data, textStatus, jqXHR) {
      $scope.textStatus = textStatus;
      $scope.xhrInProgress = false;
      $scope.responseData = data;
      $scope.xhr = jqXHR;
      $scope.responseHeaders = getResponseHeaders(jqXHR);

      $scope.$digest();
    });
  }

  $scope.setInputMode = function (mode) {
    $scope.inputMode = mode;
  };

  $scope.prettyPrint = function (input) {
    // Try if it's JSON
    try {
      return JSON.stringify(JSON.parse(input), null, 2);
    } catch (jsonError) {}

    return input;
  };

  // Returns true if response is JSON
  $scope.isJson = function (value) {
    var err;
    try {
      JSON.parse(value);
    } catch (error) {
      err = error;
    }

    return !err;
  };

  $scope.isHTML = function (value) {
    var a = window.document.createElement('div');
    a.innerHTML = value;
    for (var c = a.childNodes, i = c.length; i--;) {
      if (c[i].nodeType === 1) {
        return true;
      }
    }
    return false;
  };

  $scope.isPlain = function (value) {
    return !$scope.isHTML(value) && !$scope.isJson(value);
  };

  function parseHeaders(headers) {
    var result = {};

    headers.split('\n').forEach(function (line) {
      var key = line.split(':')[0];
      var value = line.split(':')[1];
      if (key && angular.isString(key) && angular.isString(value)) {
        result[key.trim()] = value.trim();
      }
    });

    return result;
  }

  function getResponseHeaders(xhr) {
    return parseHeaders(xhr.getAllResponseHeaders());
  }

  $scope.getSecuirtyOptions = function () {
    var none = [NONE_SECURITY];
    if (Array.isArray($scope.operation.security)) {
      return none.concat($scope.operation.security.map(function (security) {
        return Object.keys(security)[0];
      }));
    }
    return none;
  };
  $scope.securityIsAuthenticated = function (securityName) {
    if (securityName === NONE_SECURITY) {
      return true;
    }
    return AuthManager.securityIsAuthenticated(securityName);
  };
});
