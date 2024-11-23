# Installation Guide

## Prerequisites

- Node.js 18 or higher
- Firebase CLI
- Git (for version control)
- A Firebase project with Firestore and Storage enabled

## Firebase Project Setup

1. Create or select a Firebase project:

- Visit the [Firebase Console](https://console.firebase.google.com/)
- Create a new project or select an existing one
- Note your project ID for later use

1. Enable required services:

- Firestore Database
- Cloud Storage
- Cloud Functions

1. Configure Firebase Authentication:

- Enable Google Authentication
- Add authorized domains if needed
- Set up authorized email addresses for admin access

## Local Development Setup

1. Clone the repository:

```bash
git clone <repository-url>
cd fftcg-sync-service
