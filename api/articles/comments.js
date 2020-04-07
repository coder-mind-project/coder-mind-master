const MyDate = require('../../config/Date')

/**
 * @function
 * @module Comments
 * @description Provide some middlewares functions.
 * @param {Object} app - A app Object provided by consign.
 * @returns {Object} Containing some middleware functions.
 */
module.exports = app => {
  const { Comment, Article, User } = app.config.database.schemas.mongoose
  const { validateLength } = app.config.validation
  const { commentError } = app.api.responses
  const { sendEmail } = app.api.articles.emails

  /**
   * @function
   * @description Get comments
   * @param {Object} req - Request object provided by Express.js
   * @param {Object} res - Response object provided by Express.js
   *
   * @middlewareParams {Number} limit - Limit comments per page
   * @middlewareParams {String} type - Comment type, allowed: `all`, `not-readed` and `only-readed`
   * @middlewareParams {Number} page - Current page
   *
   * @returns {Object} A object containing count, limit and Comments Objects representation
   */
  const get = async (req, res) => {
    try {
      const { type } = req.query

      const page = parseInt(req.query.page) || 1
      const limit = parseInt(req.query.limit) || 10

      const user = req.user.user

      let result = null

      switch (type) {
        case 'all': {
          // Get all comments (except comment answers)
          result = await getAllComments(user, page, limit)
          break
        }
        case 'not-readed': {
          // Get not readed comments (except comment answers)
          result = await getNotReadedComments(user, page, limit)
          break
        }
        case 'only-readed': {
          // Get only readed comments (except comment answers)
          result = await getOnlyReadedComments(user, page, limit)
          break
        }
      }

      if (!result) {
        throw {
          name: 'type',
          description: 'Tipo de comentário inválido'
        }
      }

      if (!result.status) {
        throw {
          name: 'internal-error',
          description: 'Ocorreu um erro interno, se persistir reporte'
        }
      }

      const { comments, count } = result

      return res.json({ comments, count, limit })
    } catch (error) {
      const stack = await commentError(error)
      return res.status(stack.code).send(stack)
    }
  }

  /**
   * @function
   * @description Get not readed comments (except answers)
   * @param {Object} user - User object representation (provided from jwt passport)
   * @param {Number} page - Current page
   * @param {Number} limit - Limit comments per page
   *
   * @returns {Object} A object containing status operation, count, limit and Comments Object representation
   */
  const getNotReadedComments = async (user, page, limit) => {
    try {
      let count = await Comment.aggregate([
        {
          $lookup: {
            from: 'articles',
            localField: 'articleId',
            foreignField: '_id',
            as: 'article'
          }
        },
        {
          $project: {
            article: { $arrayElemAt: ['$article', 0] },
            answerOf: 1,
            readedAt: 1
          }
        },
        {
          $lookup: {
            from: 'users',
            localField: 'article.author',
            foreignField: '_id',
            as: 'article.author'
          }
        },
        {
          $project: {
            article: {
              author: { $arrayElemAt: ['$article.author', 0] }
            },
            answerOf: 1,
            readedAt: 1
          }
        },
        {
          $match: {
            $and: [
              { 'article.author._id': app.mongo.Types.ObjectId.isValid(user._id) ? app.mongo.Types.ObjectId(user._id) : null },
              { answerOf: null },
              { readedAt: null }
            ]
          }
        }
      ]).count('id')

      count = count.length > 0 ? count.reduce(item => item).id : 0

      const comments = await Comment.aggregate([
        {
          $lookup: {
            from: 'articles',
            localField: 'articleId',
            foreignField: '_id',
            as: 'article'
          }
        },
        {
          $lookup: {
            from: 'comments',
            localField: 'answerOf',
            foreignField: '_id',
            as: 'answerOf'
          }
        },
        {
          $project: {
            _id: 1,
            userEmail: 1,
            userName: 1,
            message: 1,
            confirmedAt: 1,
            readedAt: 1,
            createdAt: 1,
            updatedAt: 1,
            answerOf: { $arrayElemAt: ['$answerOf', 0] },
            article: { $arrayElemAt: ['$article', 0] }
          }
        },
        {
          $lookup: {
            from: 'users',
            localField: 'article.author',
            foreignField: '_id',
            as: 'article.author'
          }
        },
        {
          $project: {
            _id: 1,
            userEmail: 1,
            userName: 1,
            message: 1,
            confirmedAt: 1,
            readedAt: 1,
            createdAt: 1,
            updatedAt: 1,
            answerOf: 1,
            article: {
              _id: 1,
              title: 1,
              customURL: 1,
              author: { $arrayElemAt: ['$article.author', 0] }
            }
          }
        },
        {
          $project: {
            _id: 1,
            userEmail: 1,
            userName: 1,
            message: 1,
            confirmedAt: 1,
            readedAt: 1,
            createdAt: 1,
            updatedAt: 1,
            answerOf: 1,
            article: {
              _id: 1,
              title: 1,
              customURL: 1,
              author: {
                _id: 1,
                name: 1,
                tagAdmin: 1,
                tagAuthor: 1,
                customUrl: 1,
                profilePhoto: 1
              }
            }
          }
        },
        {
          $match: {
            $and: [
              { 'article.author._id': app.mongo.Types.ObjectId.isValid(user._id) ? app.mongo.Types.ObjectId(user._id) : null },
              { answerOf: null },
              { readedAt: null }
            ]
          }
        },
        { $sort: { createdAt: -1 } }
      ])
        .skip(page * limit - limit)
        .limit(limit)

      return { comments, status: true, count, limit }
    } catch (error) {
      return { status: false, error, count: 0, limit }
    }
  }

  /**
   * @function
   * @description Get only readed comments (except answers)
   * @param {Object} user - User object representation (provided from jwt passport)
   * @param {Number} page - Current page
   * @param {Number} limit - Limit comments per page
   *
   * @returns {Object} A object containing status operation, count, limit and Comments Object representation
   */
  const getOnlyReadedComments = async (user, page, limit) => {
    try {
      let count = await Comment.aggregate([
        {
          $lookup: {
            from: 'articles',
            localField: 'articleId',
            foreignField: '_id',
            as: 'article'
          }
        },
        {
          $project: {
            article: { $arrayElemAt: ['$article', 0] },
            answerOf: 1,
            readedAt: 1
          }
        },
        {
          $lookup: {
            from: 'users',
            localField: 'article.author',
            foreignField: '_id',
            as: 'article.author'
          }
        },
        {
          $project: {
            article: {
              author: { $arrayElemAt: ['$article.author', 0] }
            },
            answerOf: 1,
            readedAt: 1
          }
        },
        {
          $match: {
            $and: [
              { 'article.author._id': app.mongo.Types.ObjectId.isValid(user._id) ? app.mongo.Types.ObjectId(user._id) : null },
              { answerOf: null },
              { readedAt: { $ne: null } }
            ]
          }
        }
      ]).count('id')

      count = count.length > 0 ? count.reduce(item => item).id : 0

      const comments = await Comment.aggregate([
        {
          $lookup: {
            from: 'articles',
            localField: 'articleId',
            foreignField: '_id',
            as: 'article'
          }
        },
        {
          $lookup: {
            from: 'comments',
            localField: 'answerOf',
            foreignField: '_id',
            as: 'answerOf'
          }
        },
        {
          $project: {
            _id: 1,
            userEmail: 1,
            userName: 1,
            message: 1,
            confirmedAt: 1,
            readedAt: 1,
            createdAt: 1,
            updatedAt: 1,
            answerOf: { $arrayElemAt: ['$answerOf', 0] },
            article: { $arrayElemAt: ['$article', 0] }
          }
        },
        {
          $lookup: {
            from: 'users',
            localField: 'article.author',
            foreignField: '_id',
            as: 'article.author'
          }
        },
        {
          $project: {
            _id: 1,
            userEmail: 1,
            userName: 1,
            message: 1,
            confirmedAt: 1,
            readedAt: 1,
            createdAt: 1,
            updatedAt: 1,
            answerOf: 1,
            article: {
              _id: 1,
              title: 1,
              customURL: 1,
              author: { $arrayElemAt: ['$article.author', 0] }
            }
          }
        },
        {
          $project: {
            _id: 1,
            userEmail: 1,
            userName: 1,
            message: 1,
            confirmedAt: 1,
            readedAt: 1,
            createdAt: 1,
            updatedAt: 1,
            answerOf: 1,
            article: {
              _id: 1,
              title: 1,
              customURL: 1,
              author: {
                _id: 1,
                name: 1,
                tagAdmin: 1,
                tagAuthor: 1,
                customUrl: 1,
                profilePhoto: 1
              }
            }
          }
        },
        {
          $match: {
            $and: [
              { 'article.author._id': app.mongo.Types.ObjectId.isValid(user._id) ? app.mongo.Types.ObjectId(user._id) : null },
              { answerOf: null },
              { readedAt: { $ne: null } }
            ]
          }
        },
        { $sort: { createdAt: -1 } }
      ])
        .skip(page * limit - limit)
        .limit(limit)

      return { comments, status: true, count, limit }
    } catch (error) {
      return { status: false, error, count: 0, limit }
    }
  }

  /**
   * @function
   * @description Get all comments (except answers)
   * @param {Object} user - User object representation (provided from jwt passport)
   * @param {Number} page - Current page
   * @param {Number} limit - Limit comments per page
   *
   * @returns {Object} A object containing status operation, count, limit and Comments Object representation
   */
  const getAllComments = async (user, page, limit) => {
    try {
      let count = await Comment.aggregate([
        {
          $lookup: {
            from: 'articles',
            localField: 'articleId',
            foreignField: '_id',
            as: 'article'
          }
        },
        {
          $project: {
            article: { $arrayElemAt: ['$article', 0] },
            answerOf: 1
          }
        },
        {
          $lookup: {
            from: 'users',
            localField: 'article.author',
            foreignField: '_id',
            as: 'article.author'
          }
        },
        {
          $project: {
            article: {
              author: { $arrayElemAt: ['$article.author', 0] }
            },
            answerOf: 1
          }
        },
        {
          $match: {
            $and: [{ 'article.author._id': app.mongo.Types.ObjectId.isValid(user._id) ? app.mongo.Types.ObjectId(user._id) : null }, { answerOf: null }]
          }
        }
      ]).count('id')

      count = count.length > 0 ? count.reduce(item => item).id : 0

      const comments = await Comment.aggregate([
        {
          $lookup: {
            from: 'articles',
            localField: 'articleId',
            foreignField: '_id',
            as: 'article'
          }
        },
        {
          $lookup: {
            from: 'comments',
            localField: 'answerOf',
            foreignField: '_id',
            as: 'answerOf'
          }
        },
        {
          $project: {
            _id: 1,
            userEmail: 1,
            userName: 1,
            message: 1,
            confirmedAt: 1,
            readedAt: 1,
            createdAt: 1,
            updatedAt: 1,
            answerOf: { $arrayElemAt: ['$answerOf', 0] },
            article: { $arrayElemAt: ['$article', 0] }
          }
        },
        {
          $lookup: {
            from: 'users',
            localField: 'article.author',
            foreignField: '_id',
            as: 'article.author'
          }
        },
        {
          $project: {
            _id: 1,
            userEmail: 1,
            userName: 1,
            message: 1,
            confirmedAt: 1,
            readedAt: 1,
            createdAt: 1,
            updatedAt: 1,
            answerOf: 1,
            article: {
              _id: 1,
              title: 1,
              customURL: 1,
              author: { $arrayElemAt: ['$article.author', 0] }
            }
          }
        },
        {
          $project: {
            _id: 1,
            userEmail: 1,
            userName: 1,
            message: 1,
            confirmedAt: 1,
            readedAt: 1,
            createdAt: 1,
            updatedAt: 1,
            answerOf: 1,
            article: {
              _id: 1,
              title: 1,
              customURL: 1,
              author: {
                _id: 1,
                name: 1,
                tagAdmin: 1,
                tagAuthor: 1,
                customUrl: 1,
                profilePhoto: 1
              }
            }
          }
        },
        {
          $match: {
            $and: [{ 'article.author._id': app.mongo.Types.ObjectId.isValid(user._id) ? app.mongo.Types.ObjectId(user._id) : null }, { answerOf: null }]
          }
        },
        { $sort: { createdAt: -1 } }
      ])
        .skip(page * limit - limit)
        .limit(limit)

      return { comments, status: true, count, limit }
    } catch (error) {
      return { status: false, error, count: 0, limit }
    }
  }

  /**
   * @function
   * @description Get a comment by identifier
   * @param {String} _id
   *
   * @returns {Object} A object containing status operation and Comment Object representation
   */
  const getOne = async _id => {
    try {
      if (!app.mongo.Types.ObjectId.isValid(_id)) {
        throw {
          name: '_id',
          description: 'Identificador inválido'
        }
      }

      const comments = await Comment.aggregate([
        {
          $lookup: {
            from: 'articles',
            localField: 'articleId',
            foreignField: '_id',
            as: 'article'
          }
        },
        {
          $lookup: {
            from: 'comments',
            localField: 'answerOf',
            foreignField: '_id',
            as: 'answerOf'
          }
        },
        {
          $project: {
            _id: 1,
            userEmail: 1,
            userName: 1,
            message: 1,
            confirmedAt: 1,
            readedAt: 1,
            createdAt: 1,
            updatedAt: 1,
            answerOf: { $arrayElemAt: ['$answerOf', 0] },
            article: { $arrayElemAt: ['$article', 0] }
          }
        },
        {
          $lookup: {
            from: 'users',
            localField: 'article.author',
            foreignField: '_id',
            as: 'article.author'
          }
        },
        {
          $project: {
            _id: 1,
            userEmail: 1,
            userName: 1,
            message: 1,
            confirmedAt: 1,
            readedAt: 1,
            createdAt: 1,
            updatedAt: 1,
            answerOf: 1,
            article: {
              _id: 1,
              title: 1,
              customURL: 1,
              author: { $arrayElemAt: ['$article.author', 0] }
            }
          }
        },
        {
          $project: {
            _id: 1,
            userEmail: 1,
            userName: 1,
            message: 1,
            confirmedAt: 1,
            readedAt: 1,
            createdAt: 1,
            updatedAt: 1,
            answerOf: 1,
            article: {
              _id: 1,
              title: 1,
              customURL: 1,
              author: {
                _id: 1,
                name: 1,
                tagAdmin: 1,
                tagAuthor: 1,
                customUrl: 1,
                profilePhoto: 1
              }
            }
          }
        },
        {
          $match: {
            $and: [
              { _id: app.mongo.Types.ObjectId.isValid(_id) ? app.mongo.Types.ObjectId(_id) : null },
              { answerOf: null }
            ]
          }
        },
        {
          $lookup: {
            from: 'comments',
            localField: '_id',
            foreignField: 'answerOf',
            as: 'answers'
          }
        },
        {
          $project: {
            _id: 1,
            userEmail: 1,
            userName: 1,
            message: 1,
            confirmedAt: 1,
            readedAt: 1,
            createdAt: 1,
            updatedAt: 1,
            answerOf: 1,
            article: {
              _id: 1,
              title: 1,
              customURL: 1,
              author: {
                _id: 1,
                name: 1,
                tagAdmin: 1,
                tagAuthor: 1,
                customUrl: 1,
                profilePhoto: 1
              }
            },
            answers: {
              _id: 1,
              confirmedAt: 1,
              readedAt: 1,
              answerOf: 1,
              userName: 1,
              userEmail: 1,
              articleId: 1,
              message: 1,
              createdAt: 1,
              updatedAt: 1
            }
          }
        }
      ])

      const comment = Array.isArray(comments) ? comments[0] : {}

      return { comment, status: true }
    } catch (error) {
      return { status: false, error }
    }
  }

  /**
   * @function
   * @description Middleware for get a comment by identifier / ID
   * @param {Object} req - Request object provided by Express.js
   * @param {Object} res - Response object provided by Express.js
   *
   * @returns {Object} A object containing the Comment Object representation
   */
  const getById = async (req, res) => {
    try {
      const { id } = req.params

      const { comment, status, error } = await getOne(id)

      if (!status) {
        throw error
      }

      return res.json(comment)
    } catch (error) {
      const stack = await commentError(error)
      return res.status(stack.code).send(stack)
    }
  }

  /**
   * @function
   * @description Middleware for get the answers history comment
   * @param {Object} req - Request object provided by Express.js
   * @param {Object} res - Response object provided by Express.js
   *
   * @middlewareParams {String} id - Comment identifier / ID
   *
   *  @returns {Object} A object containing count, limit and the Comment answers
   */
  const getHistory = async (req, res) => {
    try {
      const { id } = req.params
      const limit = parseInt(req.query.limit) || 10
      const page = parseInt(req.query.page) || 1

      if (!app.mongo.Types.ObjectId.isValid(id)) {
        throw 'Identificador inválido'
      }

      const count = await Comment.countDocuments({ answerOf: id })

      const answers = await Comment.aggregate([
        {
          $match: {
            answerOf: app.mongo.Types.ObjectId(id)
          }
        }
      ]).skip(page * limit - limit)
        .limit(limit)

      return res.json({ answers, count, limit })
    } catch (error) {
      const stack = await commentError(error)
      return res.status(stack.code).send(stack)
    }
  }

  /**
   * @function
   * @description Sets 'Read' state for the Comment
   * @param {Object} req - Request object provided by Express.js
   * @param {Object} res - Response object provided by Express.js
   *
   * @middlewareParams {String} id - Comment identifier / ID
   *
   * @returns {Object} A object containing count, limit and the Comment answers
   */
  const readComment = async (req, res) => {
    try {
      const { id } = req.params

      if (!app.mongo.Types.ObjectId.isValid(id)) {
        throw 'Identificador inválido'
      }

      const readedState = { readedAt: MyDate.setTimeZone('-3') }

      const { nModified } = await Comment.updateOne({ _id: id, readedAt: null }, readedState)

      if (!nModified) {
        throw {
          name: '_id',
          description: 'Este comentário já esta marcado como lido'
        }
      }

      return res.status(204).send()
    } catch (error) {
      const stack = await commentError(error)
      return res.status(stack.code).send(stack)
    }
  }

  /**
   * @function
   * @description Allow the user answer the reader comment
   * @param {Object} req - Request object provided by Express.js
   * @param {Object} res - Response object provided by Express.js
   *
   * @middlewareParams {String} `answer` - Comment answer
   * @middlewareParams {String} `id` - Comment identifier / ID
   * @middlewareParams {String} `notify` - Flag to send email to reader. The values possible are `yes` and `no` (default)
   *
   * @returns {Object} A object containing count, limit and the Comment answers
   */
  const answerComment = async (req, res) => {
    try {
      const { answer } = req.body

      const answerOf = req.params.id

      // Send email flag
      const sendNotification = req.query.notify || 'no'

      const { user } = req.user

      validateLength(
        answer,
        10000,
        'bigger',
        { name: 'answer', description: 'Para o comentário é somente permitido 10000 caracteres' }
      )

      // Get the articleId in answered comment(root comment)
      const root = await getOne(answerOf)
      const articleId = root.status ? root.comment.article._id : null

      if (!articleId) {
        throw {
          name: 'answerOf',
          description: 'Comentário não encontrado'
        }
      }

      const comment = new Comment({
        userName: user.name,
        userEmail: user.email,
        message: answer,
        articleId,
        answerOf
      })

      const createdAnswer = await comment.save().then((newAnswer) => {
        if (sendNotification === 'yes') {
          const payload = {
            comment: root.comment,
            answer: newAnswer
          }

          sendEmail('answer-sent', payload)
        }
      })

      return res.status(201).send(createdAnswer)
    } catch (error) {
      const stack = await commentError(error)
      return res.status(stack.code).send(stack)
    }
  }

  /**
   * @function
   * @description Job for count article comments in current month (general and per user stats)
   */
  const commentsJob = async () => {
    const currentMonth = new Date().getMonth()
    const currentYear = new Date().getFullYear()
    const firstDay = new Date(currentYear, currentMonth, 1)
    const lastDay = new Date(currentYear, currentMonth, 31)

    // Users (authors and admins) list
    const users = await User.find({ deletedAt: null }, { _id: 1 })

    // Insert comments quantity per User in MySQL database
    users.map(async user => {
      let userComments = await Comment.aggregate([
        {
          $lookup: {
            from: 'articles',
            localField: 'articleId',
            foreignField: '_id',
            as: 'article'
          }
        },
        {
          $project: {
            _id: 1,
            answerOf: 1,
            createdAt: 1,
            article: { $arrayElemAt: ['$article', 0] }
          }
        },
        {
          $match: {
            $and: [
              { 'article.author': app.mongo.Types.ObjectId(user.id) },
              { answerOf: null },
              {
                createdAt: {
                  $gte: firstDay,
                  $lt: lastDay
                }
              }
            ]
          }
        }
      ]).count('id')

      userComments = userComments.length > 0 ? userComments.reduce(item => item).id : 0

      await app.knex('comments').insert({
        month: currentMonth + 1,
        count: userComments,
        year: currentYear,
        reference: user.id
      })
    })

    /* Estatísticas gerais de plataforma */
    const comments = await Comment.countDocuments({
      createdAt: {
        $gte: firstDay,
        $lt: lastDay
      },
      answerOf: null
    })

    app
      .knex('comments')
      .insert({ month: currentMonth + 1, count: comments, year: currentYear })
      .then(() => {
        // eslint-disable-next-line no-console
        console.log(`**CRON** | comments updated at ${new Date()}`)
      })
  }

  // ===================================================================== //
  // Comment statistics below
  // Refactor later

  /**
   * @function
   * @needsUpdate
   */
  const getStats = async _id => {
    try {
      const comments = await getCommentsStats(_id)
      return { status: true, comments }
    } catch (error) {
      return { status: error, comments: {} }
    }
  }

  /**
   * @function
   * @needsUpdate
   */
  const getCommentsStats = async _id => {
    let results = []

    if (_id) {
      results = await app.knex
        .select()
        .from('comments')
        .where('reference', _id)
        .orderBy('id', 'desc')
        .first()
    } else {
      results = await app.knex
        .select()
        .from('comments')
        .whereNull('reference')
        .orderBy('id', 'desc')
        .first()
    }

    return results
  }

  /**
   * @function
   * @needsUpdate
   */
  const getCommentsPerArticle = async (article, page, limit) => {
    try {
      if (!page) page = 1
      if (!limit || limit > 100) limit = 10

      const count = await Comment.find({
        'article._id': { $regex: `${article._id}`, $options: 'i' },
        answerOf: null
      }).countDocuments()
      const comments = await Comment.aggregate([
        {
          $match: {
            'article._id': { $regex: `${article._id}`, $options: 'i' },
            answerOf: null
          }
        },
        { $sort: { startRead: -1 } }
      ])
        .skip(page * limit - limit)
        .limit(limit)

      return { status: true, comments, count }
    } catch (error) {
      return { status: false, comments: [], count: 0 }
    }
  }

  /**
   * @function
   * @needsUpdate
   */
  const getComments = async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1
      let limit = parseInt(req.query.limit) || 10

      if (limit > 100) limit = 10

      const _id = req.params.id

      const article = await Article.findOne({ _id })

      const result = await getCommentsPerArticle(article, page, limit)

      if (result.status) {
        const comments = result.comments
        const count = result.count

        return res.json({ comments, count })
      } else {
        throw 'Ocorreu um erro ao encontrar os comentários'
      }
    } catch (error) {
      return res.status(500).send(error)
    }
  }

  // End comment statistics
  // ========================================================= //

  return {
    get,
    readComment,
    answerComment,
    getById,
    getHistory,
    commentsJob,
    getStats,
    getCommentsPerArticle,
    getComments
  }
}
