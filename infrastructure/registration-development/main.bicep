// REVIEW ONLY. Do not deploy without organiser approval.
targetScope = 'resourceGroup'

@description('Short, globally unique lowercase prefix supplied at deployment review time.')
param resourcePrefix string
param location string = 'uksouth'
param tags object = { workload: 'registration', environment: 'development', dataClassification: 'synthetic-only' }
param allowedOrigins array = []

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: '${resourcePrefix}store'
  location: location
  tags: tags
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    supportsHttpsTrafficOnly: true
    publicNetworkAccess: 'Enabled'
  }
}

resource tableService 'Microsoft.Storage/storageAccounts/tableServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource registrations 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = {
  parent: tableService
  name: 'registrationsdevelopment'
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: { deleteRetentionPolicy: { enabled: true, days: 14 } }
}

resource backups 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'registrationbackups'
  properties: { publicAccess: 'None' }
}

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${resourcePrefix}-logs'
  location: location
  tags: tags
  properties: { retentionInDays: 30, features: { enableLogAccessUsingOnlyResourcePermissions: true } }
}

resource insights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${resourcePrefix}-insights'
  location: location
  tags: tags
  kind: 'web'
  properties: { Application_Type: 'web', WorkspaceResourceId: logs.id, DisableLocalAuth: true }
}

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${resourcePrefix}-functions-plan'
  location: location
  tags: tags
  kind: 'linux'
  sku: { name: 'Y1', tier: 'Dynamic' }
  properties: { reserved: true }
}

resource functionApp 'Microsoft.Web/sites@2023-12-01' = {
  name: '${resourcePrefix}-api'
  location: location
  tags: tags
  kind: 'functionapp,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    publicNetworkAccess: 'Enabled'
    siteConfig: {
      linuxFxVersion: 'NODE|20'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      cors: { allowedOrigins: allowedOrigins, supportCredentials: false }
      appSettings: [
        { name: 'FUNCTIONS_EXTENSION_VERSION', value: '~4' }
        { name: 'FUNCTIONS_WORKER_RUNTIME', value: 'node' }
        { name: 'AzureWebJobsStorage__accountName', value: storage.name }
        { name: 'REGISTRATION_ENVIRONMENT', value: 'development' }
        { name: 'REGISTRATION_STATE', value: 'closed' }
        { name: 'REGISTRATION_STORAGE_ACCOUNT_URL', value: storage.properties.primaryEndpoints.table }
        { name: 'REGISTRATION_TABLE_NAME', value: registrations.name }
        { name: 'REGISTRATION_BACKUP_CONTAINER', value: backups.name }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: insights.properties.ConnectionString }
      ]
    }
  }
}

resource tableRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, functionApp.id, 'table-data')
  scope: storage
  properties: { roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'), principalId: functionApp.identity.principalId, principalType: 'ServicePrincipal' }
}

resource blobRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, functionApp.id, 'blob-data')
  scope: storage
  properties: { roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b'), principalId: functionApp.identity.principalId, principalType: 'ServicePrincipal' }
}

// Entra application registration, group assignments and Static Web App/API
// linkage remain approval-time tenant operations. No password or shared-key
// setting is present in this proposal.

output proposedTableResourceId string = registrations.id
output proposedMonitoringResourceId string = insights.id
output proposedApiHostname string = functionApp.properties.defaultHostName
