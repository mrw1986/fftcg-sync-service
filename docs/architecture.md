# System Architecture

## Overview

FFTCG Sync Service is built on Firebase Cloud Functions with a microservices architecture, designed to synchronize card data, prices, and images from TCGplayer while maintaining high performance and reliability.

## System Diagram

The diagram below shows the key components and their interactions:

<ArchitectureDiagram :zoom="1" :showLabels="true" />

## Core Components

### Cloud Functions

```mermaid
graph TD
    A[Scheduled Triggers] -->|Daily| B[Sync Functions]
    C[HTTP Triggers] -->|Manual| B
    B --> D[Card Sync]
    B --> E[Price Sync]
    B --> F[Image Processing]
```

#### Functions Structure

- `scheduledCardSync` - Daily card data synchronization
- `scheduledPriceSync` - Daily price updates
- `testCardSync` - Test endpoint for card sync
- `testPriceSync` - Test endpoint for price sync
- `manualCardSync` - Manual trigger for full sync
- `manualPriceSync` - Manual trigger for price sync
- `healthCheck` - System health monitoring

### Storage Systems

```mermaid
graph LR
    A[Cloud Functions] --> B[Firestore]
    A --> C[Cloud Storage]
    B --> D[(Cards Collection)]
    B --> E[(Prices Collection)]
    B --> F[(Sync Metadata)]
    C --> G[Card Images]
```

#### Database Collections

- `cards` - Card information and metadata
- `prices` - Current and historical price data
- `syncMetadata` - Sync operation logs and status
- `logs` - System logs and operations history
- `cardHashes` - Change detection hashes
- `priceHashes` - Price update tracking
- `imageMetadata` - Image processing metadata

### Processing Pipeline

```mermaid
graph TD
    A[Data Source] -->|Fetch| B[Raw Data]
    B -->|Validate| C[Validation Layer]
    C -->|Process| D[Processing Layer]
    D -->|Store| E[Storage Layer]
    D -->|Cache| F[Cache Layer]
```

#### Pipeline Components

- Data Fetching
- Validation & Sanitization
- Processing & Transformation
- Storage Management
- Cache Management

## Service Integration

### External Services

```mermaid
graph LR
    A[FFTCG Sync Service] -->|Cards Data| B[TCGplayer API]
    A -->|Prices| B
    A -->|Images| C[TCGplayer CDN]
    A --> D[Firebase Services]
```

### Internal Services Communication

```mermaid
graph TD
    A[Sync Controller] --> B[Card Service]
    A --> C[Price Service]
    A --> D[Image Service]
    B --> E[Storage Service]
    C --> E
    D --> E
```

## Data Flow

### Synchronization Flow

```mermaid
sequenceDiagram
    participant T as Trigger
    participant S as Sync Service
    participant E as External API
    participant D as Database
    participant C as Cache
   
    T->>S: Initiate Sync
    S->>C: Check Cache
    S->>E: Fetch Updates
    E->>S: Return Data
    S->>D: Store Updates
    S->>C: Update Cache
```

## Error Handling

### Recovery System

```mermaid
graph TD
    A[Error Detection] -->|Classify| B[Error Types]
    B -->|Transient| C[Retry Logic]
    B -->|Permanent| D[Failure Handling]
    C -->|Success| E[Continue Processing]
    C -->|Max Retries| D
    D --> F[Error Logging]
    D --> G[Fallback Mechanism]
```

## Performance Optimization

### Caching Strategy

```mermaid
graph LR
    A[Request] --> B{Cache Check}
    B -->|Hit| C[Return Cached]
    B -->|Miss| D[Fetch Fresh]
    D --> E[Process]
    E --> F[Update Cache]
    F --> G[Return Fresh]
```

## Security Architecture

### Access Control

```mermaid
graph TD
    A[Request] --> B{Authentication}
    B -->|Valid| C{Authorization}
    B -->|Invalid| D[Reject]
    C -->|Allowed| E[Process]
    C -->|Denied| D
```

## Monitoring System

### Observability

```mermaid
graph TD
    A[Operations] --> B[Logging]
    A --> C[Metrics]
    A --> D[Traces]
    B --> E[Analysis]
    C --> E
    D --> E
```

## Resource Management

### Scaling Strategy

```mermaid
graph TD
    A[Load Monitor] -->|Triggers| B[Scaling Decision]
    B -->|Up| C[Increase Resources]
    B -->|Down| D[Decrease Resources]
    C --> E[Update Configuration]
    D --> E
```

## Configuration Management

### Environment Setup

```mermaid
graph LR
    A[Configuration] --> B[Development]
    A --> C[Staging]
    A --> D[Production]
    B --> E[Firebase Project]
    C --> E
    D --> E
```

## Best Practices

### Development Workflow

```mermaid
graph LR
    A[Development] -->|Test| B[Staging]
    B -->|Validate| C[Production]
    C -->|Monitor| D[Maintenance]
    D -->|Update| A
```

## System Requirements

### Infrastructure

- Node.js 18+
- Firebase Admin SDK
- Cloud Functions
- Firestore
- Cloud Storage
- Memory: 1GB minimum
- Timeout: 540s maximum

### Dependencies

- Firebase Functions
- Firebase Admin
- Axios for HTTP requests
- Sharp for image processing
- LRU Cache for caching
- TypeScript for development

## Deployment Architecture

### CI/CD Pipeline

```mermaid
graph LR
    A[Code Push] -->|Build| B[Tests]
    B -->|Pass| C[Deploy]
    C -->|Success| D[Monitor]
    D -->|Issues| E[Rollback]
```

## Additional Resources

- [Installation Guide](/setup/installation)
- [Configuration Guide](/setup/configuration)
- [API Documentation](/api/)
- [Troubleshooting Guide](/troubleshooting)
