import { getAuth } from 'firebase/auth'
import { app } from './firebase'

export const isAuthenticated = async (): Promise<boolean> => {
  const auth = getAuth(app)
  
  return new Promise((resolve) => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      unsubscribe()
      resolve(!!user)
    })
  })
}

export const checkAuth = async (path: string): Promise<boolean> => {
  const publicPaths = ['/', '/login']
  if (publicPaths.includes(path)) {
    return true
  }
  
  return await isAuthenticated()
}