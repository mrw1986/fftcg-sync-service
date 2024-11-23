# FFTCG Sync Service Documentation

## Overview

FFTCG Sync Service is a specialized Firebase application designed to synchronize Final Fantasy Trading Card Game (FFTCG) card data, prices, and images. The service provides automated synchronization of card information, price tracking, and image optimization through Firebase Functions.

## Core Features

### Card Synchronization

- Automated card data synchronization from TCGPlayer
- Batch processing for efficient data handling
- Data validation and error handling
- Support for dry-run operations

### Price Tracking

- Real-time price monitoring
- Support for both normal and foil card prices
- Price history tracking
- Configurable sync intervals

### Image Processing

- Automatic image downloading and optimization
- Multiple resolution support (200w and 400w)
- Image compression with quality preservation
- Efficient caching system
- Firebase Storage integration

### System Architecture

- Firebase Functions for serverless operation
- Firestore for data storage
- Firebase Storage for image management
- LRU caching for performance optimization

## Technical Stack

- **Runtime**: Node.js 18
- **Framework**: Firebase Functions v6
- **Database**: Firestore
- **Storage**: Firebase Storage
- **Image Processing**: Sharp
- **HTTP Client**: Axios
- **Caching**: LRU Cache
- **Language**: TypeScript

## Key Components

### Services

- `cardSync`: Manages card data synchronization
- `priceSync`: Handles price updates and tracking

### Utilities

- `ImageHandler`: Manages image processing and storage
- `ImageCompressor`: Handles image optimization
- `ImageCache`: Provides caching functionality
- `Logger`: Manages application logging
- `BatchProcessor`: Handles batch operations

## Getting Started

To get started with the FFTCG Sync Service, see:

- [Installation Guide](./setup/installation)
- [Configuration Guide](./setup/configuration)
- [API Documentation](./api/)
