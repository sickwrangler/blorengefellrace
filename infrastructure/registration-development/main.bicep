// APPROVED FOR THE ISOLATED SYNTHETIC DEVELOPMENT ENVIRONMENT ONLY.
targetScope = 'resourceGroup'

@description('Globally unique name for the isolated development Static Web App.')
param staticWebAppName string = 'swa-blorenge-registration-dev'

@description('Globally unique, lowercase name for synthetic registration storage.')
@minLength(3)
@maxLength(24)
param storageAccountName string = 'stblorengeregdev2026'

@description('Development-only Azure Communication Services resource name.')
param communicationServiceName string = 'acs-blorenge-registration-dev'

@description('Development-only Email Communication Service resource name.')
param emailServiceName string = 'ecs-blorenge-registration-dev'

@description('A region supported by both Static Web Apps and Table Storage.')
param location string = 'westeurope'

@description('Development-only resource tags. Do not put personal data in tags.')
param tags object = {
  project: 'blorenge-fell-race'
  workload: 'registration'
  environment: 'development'
  dataClassification: 'synthetic-only'
  managedBy: 'bicep'
}

resource registrationSite 'Microsoft.Web/staticSites@2023-12-01' = {
  name: staticWebAppName
  location: location
  tags: tags
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {
    allowConfigFileUpdates: true
    stagingEnvironmentPolicy: 'Disabled'
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  tags: tags
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    // Managed Static Web Apps Functions do not support managed identity.
    // Shared-key access is retained only to issue a revocable, table-scoped SAS.
    allowSharedKeyAccess: true
    publicNetworkAccess: 'Enabled'
  }
}

resource tableService 'Microsoft.Storage/storageAccounts/tableServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource registrations 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = {
  parent: tableService
  name: 'RegistrationDevelopment'
}

resource emailService 'Microsoft.Communication/emailServices@2023-03-31' = {
  name: emailServiceName
  location: 'global'
  tags: tags
  properties: {
    dataLocation: 'Europe'
  }
}

resource managedEmailDomain 'Microsoft.Communication/emailServices/domains@2023-03-31' = {
  parent: emailService
  name: 'AzureManagedDomain'
  location: 'global'
  tags: tags
  properties: {
    domainManagement: 'AzureManaged'
    userEngagementTracking: 'Disabled'
  }
}

resource communicationService 'Microsoft.Communication/communicationServices@2023-03-31' = {
  name: communicationServiceName
  location: 'global'
  tags: tags
  properties: {
    dataLocation: 'Europe'
    linkedDomains: [managedEmailDomain.id]
  }
}

output staticWebAppName string = registrationSite.name
output staticWebAppDefaultHostname string = registrationSite.properties.defaultHostname
output storageAccountName string = storage.name
output tableName string = registrations.name
output communicationServiceName string = communicationService.name
output emailServiceName string = emailService.name
output managedSenderDomainId string = managedEmailDomain.id
